import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  err,
  type IdentityStanding,
  type LandedRegistration,
  ok,
  type Result,
  type TxHash,
} from "@binference/plugin-sdk";
import { decodeLog, type RpcFailover } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddress,
  parseAbi,
} from "viem";
import { z } from "zod";
import type { RegistryAt } from "../calls/register-call.js";

// From ERC-8004's reference registry, `IdentityRegistryUpgradeable.sol` 2.0.0 of
// erc-8004/erc-8004-contracts, the implementation BSC's registry runs, and ERC-721, which it extends.
const readsAbi = parseAbi([
  "function getVersion() pure returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const eventsAbi = parseAbi([
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

/** Where a read runs: the chain's RPC failover, the registry and the caller's signal. */
export interface RegistryRead {
  readonly rpc: RpcFailover;
  readonly registry: RegistryAt;
  readonly signal: AbortSignal;
}

/** One view of the registry: its calldata, and how its answer reads. */
interface View<T> {
  readonly name: string;
  readonly callData: Hex;
  /** Reads the answer; throws on an answer outside the function's shape. */
  readonly decode: (data: Hex) => T;
}

const hexSchema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]*$/)]);
const quantitySchema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]+$/)]);
const receiptSchema = z
  .object({
    status: hexSchema,
    logs: z.array(z.object({ address: hexSchema, topics: z.array(hexSchema), data: hexSchema })),
  })
  .nullable();

// A fault of a read: the registry answered outside its shape, or reverted a view it answers.
function unreadable(problem: string): BinferenceError {
  return new BinferenceError({
    code: "erc8004.read_failed",
    message: `The ERC-8004 identity registry could not be read: ${problem}`,
  });
}

// The EVM address of a wallet; another kind of account is `erc8004.bad_request`.
function walletAddress(wallet: AccountRef): Address {
  const { address } = accountRefParts(wallet);
  if (!isAddress(address, { strict: false })) {
    throw new BinferenceError({
      code: "erc8004.bad_request",
      message: "A registration names an EVM wallet.",
    });
  }
  return getAddress(address);
}

const versionView: View<string> = {
  name: "getVersion",
  callData: encodeFunctionData({ abi: readsAbi, functionName: "getVersion" }),
  decode: (data) => decodeFunctionResult({ abi: readsAbi, functionName: "getVersion", data }),
};

function balanceView(owner: Address): View<bigint> {
  return {
    name: "balanceOf",
    callData: encodeFunctionData({ abi: readsAbi, functionName: "balanceOf", args: [owner] }),
    decode: (data) => decodeFunctionResult({ abi: readsAbi, functionName: "balanceOf", data }),
  };
}

function ownerView(id: bigint): View<Address> {
  return {
    name: "ownerOf",
    callData: encodeFunctionData({ abi: readsAbi, functionName: "ownerOf", args: [id] }),
    decode: (data) => decodeFunctionResult({ abi: readsAbi, functionName: "ownerOf", data }),
  };
}

function uriView(id: bigint): View<string> {
  return {
    name: "tokenURI",
    callData: encodeFunctionData({ abi: readsAbi, functionName: "tokenURI", args: [id] }),
    decode: (data) => decodeFunctionResult({ abi: readsAbi, functionName: "tokenURI", data }),
  };
}

async function latestBlock(read: RegistryRead): Promise<Hex> {
  const reply = await read.rpc.request({
    method: "eth_blockNumber",
    params: [],
    result: quantitySchema,
    signal: read.signal,
    atHead: true,
  });
  if (reply.kind === "error") {
    throw unreadable("the latest block could not be read.");
  }
  return reply.value;
}

// One view at the block; a revert or an answer outside its shape is a fault.
async function viewAt<T>(read: RegistryRead, block: Hex, view: View<T>): Promise<T> {
  const reply = await read.rpc.request({
    method: "eth_call",
    params: [{ to: read.registry.address, data: view.callData }, block],
    result: hexSchema,
    signal: read.signal,
  });
  if (reply.kind === "error") {
    throw unreadable(`${view.name} reverted.`);
  }
  try {
    return view.decode(reply.value);
  } catch {
    throw unreadable(`${view.name} answered outside its shape.`);
  }
}

/**
 * The registry's version and the wallet's count of its identity tokens, both at the latest
 * block. Rejects when no node answers, when the registry reverts or answers outside its shape
 * (`erc8004.read_failed`), and with the signal's reason once it aborts.
 */
export async function readStanding(
  read: RegistryRead,
  wallet: AccountRef,
): Promise<IdentityStanding> {
  read.signal.throwIfAborted();
  const owner = walletAddress(wallet);
  const block = await latestBlock(read);
  const [version, held] = await Promise.all([
    viewAt(read, block, versionView),
    viewAt(read, block, balanceView(owner)),
  ]);
  return { version, held };
}

// The id the transaction's `Registered` event from the registry gave the wallet; none for a revert,
// a transaction with no such event, or one that registered for another owner.
async function registeredId(
  read: RegistryRead,
  request: { readonly owner: Address; readonly txHash: TxHash },
): Promise<bigint | undefined> {
  const reply = await read.rpc.request({
    method: "eth_getTransactionReceipt",
    params: [request.txHash],
    result: receiptSchema,
    signal: read.signal,
  });
  if (reply.kind === "error") {
    throw unreadable("a transaction's receipt could not be read.");
  }
  const receipt = reply.value;
  if (receipt === null || BigInt(receipt.status) !== 1n) {
    return undefined;
  }
  for (const log of receipt.logs) {
    const event =
      getAddress(log.address) === read.registry.address ? decodeLog(eventsAbi, log) : undefined;
    if (event?.eventName === "Registered" && getAddress(event.args.owner) === request.owner) {
      return event.args.agentId;
    }
  }
  return undefined;
}

/**
 * What the transaction's registration from the wallet made: the id its `Registered` event gave,
 * then who holds that id and the file the registry holds for it, at the latest block. A receipt
 * that is missing, reverted, or holds no `Registered` event from the registry naming the wallet
 * is `not_found`. Rejects as {@link readStanding} does.
 */
export async function readLanded(
  read: RegistryRead,
  request: { readonly wallet: AccountRef; readonly txHash: TxHash },
): Promise<Result<LandedRegistration, "not_found">> {
  read.signal.throwIfAborted();
  const owner = walletAddress(request.wallet);
  const id = await registeredId(read, { owner, txHash: request.txHash });
  if (id === undefined) {
    return err("not_found");
  }
  const block = await latestBlock(read);
  const [holder, file] = await Promise.all([
    viewAt(read, block, ownerView(id)),
    viewAt(read, block, uriView(id)),
  ]);
  const { chain } = read.registry;
  return ok({
    onchainId: id.toString(),
    owner: accountRefSchema.parse(`${chain}:${getAddress(holder)}`),
    file,
  });
}
