import {
  type AccountRef,
  accountRefSchema,
  BinferenceError,
  type ChainRef,
  isTxHash,
  type SimulatedStep,
  type TxDraft,
  type TxHash,
} from "@binference/plugin-sdk";
import {
  decodeEvmDraft,
  type RpcCall,
  type RpcFailover,
  type RpcReply,
} from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  getAddress,
  type Hex,
  numberToHex,
  pad,
  parseAbi,
  toEventSelector,
  zeroAddress,
} from "viem";
import { z } from "zod";

/** ERC-8004's identity registry on BSC, as the chain registry lists it. */
export const registryAddress: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/** The contract the registry's proxy runs in the world until a test upgrades it. */
export const implementationAddress: Address = "0x7274e874CA62410a93Bd8bf61c69d8045E399c02";

// The calls and events of the reference registry, written here apart from the plugin's own.
const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function getVersion() pure returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const registeredTopic = toEventSelector("Registered(uint256,string,address)");
const transferTopic = toEventSelector("Transfer(address,address,uint256)");

/** A registry world on one chain that a test sets up, read through an RPC failover. */
export interface RegistryWorld {
  readonly rpc: RpcFailover;
  /** Runs the draft unsent, as the chain's simulator reports it, logs included. */
  simulate(draft: TxDraft): SimulatedStep;
  /** Mines the draft: a registration mints the next id to its sender. */
  land(draft: TxDraft): TxHash;
  /** Mines the draft as a transaction that reverted. */
  landReverted(draft: TxDraft): TxHash;
  /** Sets the version the registry reports. */
  setVersion(version: string): void;
  /** Points the registry's proxy at another contract, as an upgrade would. */
  upgrade(implementation: Address): void;
  /** Gives the id another holder, as a transfer would. */
  move(id: bigint, to: Address): void;
  /** Makes every view of the registry revert. */
  breakRegistry(): void;
  /** Every later request rejects as no node answering. */
  down(): void;
}

interface Log {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

interface WorldState {
  readonly chain: ChainRef;
  readonly owners: Map<bigint, Address>;
  readonly uris: Map<bigint, string>;
  readonly receipts: Map<Hex, { readonly status: Hex; readonly logs: readonly Log[] }>;
  version: string;
  implementation: Address;
  isBroken: boolean;
  isDown: boolean;
}

const block = "0x7cd3a2d";
const word = (value: bigint): Hex => pad(numberToHex(value));

// The logs of a registration that mints `id` to `owner` with the file, as the registry emits them.
function logsOf(owner: Address, id: bigint, file: string): readonly Log[] {
  return [
    {
      address: registryAddress,
      topics: [transferTopic, pad(zeroAddress), pad(owner), word(id)],
      data: "0x",
    },
    {
      address: registryAddress,
      topics: [registeredTopic, word(id), pad(owner)],
      data: encodeAbiParameters([{ type: "string" }], [file]),
    },
  ];
}

// The draft's sender and the file of its registration; `undefined` for any other call.
function registrationOf(
  draft: TxDraft,
): { readonly owner: Address; readonly file: string } | undefined {
  const evm = decodeEvmDraft(draft);
  if (!evm.ok || evm.value.to !== registryAddress || evm.value.data.length < 10) {
    return undefined;
  }
  const call = decodeFunctionData({ abi, data: evm.value.data });
  return call.functionName === "register"
    ? { owner: evm.value.from, file: call.args[0] }
    : undefined;
}

function answerView(state: WorldState, to: Address, data: Hex): Hex | undefined {
  if (getAddress(to) !== registryAddress || state.isBroken) {
    return undefined;
  }
  const call = decodeFunctionData({ abi, data });
  switch (call.functionName) {
    case "getVersion":
      return encodeFunctionResult({ abi, functionName: "getVersion", result: state.version });
    case "balanceOf": {
      const held = [...state.owners.values()].filter((owner) => owner === getAddress(call.args[0]));
      return encodeFunctionResult({ abi, functionName: "balanceOf", result: BigInt(held.length) });
    }
    case "ownerOf": {
      const owner = state.owners.get(call.args[0]);
      return owner === undefined
        ? undefined
        : encodeFunctionResult({ abi, functionName: "ownerOf", result: owner });
    }
    case "tokenURI": {
      const uri = state.uris.get(call.args[0]);
      return uri === undefined
        ? undefined
        : encodeFunctionResult({ abi, functionName: "tokenURI", result: uri });
    }
    case "register":
      return undefined;
  }
  return undefined;
}

const hex = z.templateLiteral(["0x", z.string()]);
const callParams = z.tuple([z.object({ to: hex, data: hex }), z.literal(block)]);
const receiptParams = z.tuple([hex]);

type Receipt = { readonly status: Hex; readonly logs: readonly Log[] } | null;

function valueOf<T>(state: WorldState, { method, params }: RpcCall<T>): Hex | Receipt | undefined {
  if (method === "eth_blockNumber") {
    return block;
  }
  if (method === "eth_getTransactionReceipt") {
    return state.receipts.get(receiptParams.parse(params)[0]) ?? null;
  }
  if (method === "eth_getStorageAt") {
    return pad(state.implementation, { size: 32 });
  }
  const [{ to, data }] = callParams.parse(params);
  return answerView(state, to, data);
}

// A node that is down answers nothing; a view the registry reverts is the node's revert error.
const nodeDown = { code: "chain.rpc_down", message: "No node answers.", retryable: true } as const;
const reverted = {
  kind: "error",
  endpoint: "world",
  code: 3,
  message: "execution reverted",
} as const;

async function replyTo<T>(state: WorldState, call: RpcCall<T>): Promise<RpcReply<T>> {
  call.signal.throwIfAborted();
  if (state.isDown) {
    throw new BinferenceError(nodeDown);
  }
  const value = valueOf(state, call);
  const reply: RpcReply<T> =
    value === undefined
      ? reverted
      : { kind: "result", endpoint: "world", value: call.result.parse(value) };
  return Promise.resolve(reply);
}

function hashOf(hash: Hex): TxHash {
  if (!isTxHash(hash)) {
    throw new BinferenceError({ code: "world.bad_hash", message: "A world hash is malformed." });
  }
  return hash;
}

function landIn(state: WorldState, draft: TxDraft, how: "lands" | "reverts"): TxHash {
  const hash = word(BigInt(state.receipts.size + 1));
  const registration = registrationOf(draft);
  if (registration === undefined || how === "reverts") {
    state.receipts.set(hash, { status: "0x0", logs: [] });
    return hashOf(hash);
  }
  const id = BigInt(state.owners.size);
  state.owners.set(id, registration.owner);
  state.uris.set(id, registration.file);
  state.receipts.set(hash, {
    status: "0x1",
    logs: logsOf(registration.owner, id, registration.file),
  });
  return hashOf(hash);
}

function simulateIn(state: WorldState, draft: TxDraft): SimulatedStep {
  const registration = registrationOf(draft);
  const account = (address: Address): AccountRef =>
    accountRefSchema.parse(`${state.chain}:${getAddress(address)}`);
  const logs =
    registration === undefined
      ? []
      : logsOf(registration.owner, BigInt(state.owners.size), registration.file);
  return {
    status: registration === undefined ? "reverted" : "success",
    gasUsed: 180_000n,
    transfers: [],
    approvals: [],
    logs: logs.map((log) => ({
      emitter: account(log.address),
      topics: log.topics,
      data: log.data,
    })),
  };
}

/** Creates a registry world on the chain with no identities, reporting version 2.0.0. */
export function createRegistryWorld(chain: ChainRef): RegistryWorld {
  const state: WorldState = {
    chain,
    owners: new Map(),
    uris: new Map(),
    receipts: new Map(),
    version: "2.0.0",
    implementation: implementationAddress,
    isBroken: false,
    isDown: false,
  };
  return {
    rpc: { request: async (call) => replyTo(state, call), health: () => [] },
    simulate: (draft) => simulateIn(state, draft),
    land: (draft) => landIn(state, draft, "lands"),
    landReverted: (draft) => landIn(state, draft, "reverts"),
    setVersion: (version) => {
      state.version = version;
    },
    upgrade: (implementation) => {
      state.implementation = implementation;
    },
    move: (id, to) => state.owners.set(id, getAddress(to)),
    breakRegistry: () => {
      state.isBroken = true;
    },
    down: () => {
      state.isDown = true;
    },
  };
}
