import {
  type ChainDefinition,
  type DeliveryReader,
  type DeliveryRequest,
  isTxHash,
  parseAccountRef,
  parseAssetRef,
} from "@binference/chain";
import {
  createEvmClient,
  createEvmDeliveryReader,
  createEvmReceiptReader,
  createRpcFailover,
  type EvmChain,
  evmChainOf,
  parseEvmAddress,
  type RpcFailover,
} from "@binference/chain-evm";
import { type Address, erc20Abi, type Hex, keccak256, type PublicClient, toHex } from "viem";
import type { LiveParts } from "./live-parts.mjs";
import { oneByOne } from "./one-by-one.mjs";
import { unwrapped } from "./unwrapped.mjs";

/** A fill a bridge reports on the chain: the transaction, the recipient, the token, the amount. */
export interface ReportedFill {
  readonly bridge: string;
  readonly hash: string;
  readonly recipient: string;
  /** The token's address, or the zero address for the chain's coin. */
  readonly token: string;
  readonly amount: bigint;
}

// EIP-1967's slots, then the ones Circle's FiatToken proxy keeps its implementation and admin in.
const proxySlots: readonly Hex[] = [
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  keccak256(toHex("org.zeppelinos.proxy.implementation")),
  keccak256(toHex("org.zeppelinos.proxy.admin")),
];
const ownerAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;
const zeroAddress = "0x0000000000000000000000000000000000000000";

function slotAddress(word: Hex | undefined): string {
  const value = BigInt(word ?? "0x0");
  return value === 0n ? "-" : `0x${value.toString(16).padStart(40, "0").slice(-40)}`;
}

function rpcOf(definition: ChainDefinition, parts: LiveParts): RpcFailover {
  const endpoints = definition.rpcs.map(({ name, url }) => ({ name, url }));
  return createRpcFailover({ endpoints, ...parts, timeoutMs: 20_000, restMs: 1_000 });
}

async function readEndpoints(definition: ChainDefinition, parts: LiveParts): Promise<string[]> {
  const evm = evmChainOf(definition);
  return oneByOne(definition.rpcs, async (rpc) => {
    const one = rpcOf({ ...definition, rpcs: [rpc] }, parts);
    const id = await createEvmClient({ chain: evm, rpc: one, signal: parts.signal }).getChainId();
    const verdict = id === evm.chainId ? "ok" : "WRONG";
    return `- RPC ${rpc.name} (${rpc.url}): chain id ${String(id)} ${verdict}`;
  });
}

async function readToken(
  client: PublicClient,
  token: ChainDefinition["tokens"][number],
): Promise<string> {
  const address = unwrapped(parseEvmAddress(token.address));
  const checksum = address === token.address ? "ok" : "WRONG";
  const code = (await client.getCode({ address })) ?? "0x";
  const symbol = await client.readContract({ address, abi: erc20Abi, functionName: "symbol" });
  const decimals = await client.readContract({ address, abi: erc20Abi, functionName: "decimals" });
  const owner = await client
    .readContract({ address, abi: ownerAbi, functionName: "owner" })
    .catch(() => "-");
  const slots = await oneByOne(proxySlots, async (slot) =>
    slotAddress(await client.getStorageAt({ address, slot })),
  );
  return (
    `- ${token.symbol} ${token.address}: checksum ${checksum}, code ${String((code.length - 2) / 2)} ` +
    `bytes, symbol "${symbol}", decimals ${String(decimals)} ` +
    `${decimals === token.decimals ? "ok" : "WRONG"}, EIP-1967 implementation ${slots[0] ?? "-"} ` +
    `admin ${slots[1] ?? "-"}, FiatToken implementation ${slots[2] ?? "-"} admin ` +
    `${slots[3] ?? "-"}, owner ${owner}`
  );
}

/** One delivery read as the report shows it: an error the node gave stands in for the amount. */
interface ReadLine {
  readonly received: bigint | string;
  readonly status: string;
  readonly final: string;
}

// The coin is read from the block's state, which a public node keeps for a short while only, so
// a read the node cannot answer is reported, not thrown.
async function readIn(reader: DeliveryReader, request: DeliveryRequest): Promise<ReadLine> {
  try {
    const delivery = await reader.delivery(request, { signal: AbortSignal.timeout(60_000) });
    return {
      received: delivery?.received.base ?? 0n,
      status: delivery?.status ?? "none",
      final: String(delivery?.final),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unread";
    return { received: `unread (${reason})`, status: "-", final: "-" };
  }
}

// A bridge that delivers WETH to an account with no code unwraps it into the coin, so each fill
// is read in its token and in the coin.
async function readFill(
  reader: DeliveryReader,
  evm: EvmChain,
  fill: ReportedFill,
): Promise<string> {
  const isCoin = fill.token === zeroAddress;
  const token = unwrapped(
    parseAssetRef(isCoin ? evm.nativeAsset : `${evm.ref}/erc20:${fill.token}`),
  );
  const recipient = unwrapped(parseAccountRef(`${evm.ref}:${fill.recipient}`));
  if (!isTxHash(fill.hash)) {
    throw new Error(`${fill.hash} is no transaction hash.`);
  }
  const read = await readIn(reader, { hash: fill.hash, recipient, asset: token });
  const coin = await readIn(reader, { hash: fill.hash, recipient, asset: evm.nativeAsset });
  const asCoin = coin.received === fill.amount ? "ok, as the coin" : "DIFFERS";
  const verdict = read.received === fill.amount ? "ok" : asCoin;
  return (
    `- ${fill.bridge} fill ${fill.hash}: reported ${fill.amount.toString()}, read ` +
    `${String(read.received)} in the token and ${String(coin.received)} in the coin, ` +
    `${verdict}, status ${read.status}, final ${read.final}`
  );
}

async function readContract(
  client: PublicClient,
  contract: ChainDefinition["contracts"][number],
): Promise<string> {
  const address: Address = unwrapped(parseEvmAddress(contract.address));
  const code = (await client.getCode({ address })) ?? "0x";
  const bytes = String((code.length - 2) / 2);
  return `- ${contract.venue}/${contract.name} ${contract.address}: code ${bytes} bytes`;
}

function readerOf(definition: ChainDefinition, rpc: RpcFailover): DeliveryReader {
  const evm = evmChainOf(definition);
  const multicallEntry = definition.contracts.find(({ venue }) => venue === "multicall3");
  const multicall = unwrapped(parseEvmAddress(multicallEntry?.address ?? ""));
  const receipts = createEvmReceiptReader({ rpc, chain: evm, finality: definition.finality });
  return createEvmDeliveryReader({ rpc, chain: evm, receipts, multicall });
}

/** Reads every address of an EVM chain file back on the chain, and the fills a bridge reported. */
export async function readEvmChain(
  definition: ChainDefinition,
  fills: readonly ReportedFill[],
  parts: LiveParts,
): Promise<string[]> {
  const evm = evmChainOf(definition);
  const rpc = rpcOf(definition, parts);
  const client = createEvmClient({ chain: evm, rpc, signal: parts.signal });
  const reader = readerOf(definition, rpc);
  return [
    `### ${definition.name} (${definition.id})`,
    ...(await readEndpoints(definition, parts)),
    ...(await oneByOne(definition.tokens, async (token) => readToken(client, token))),
    ...(await oneByOne(definition.contracts, async (contract) => readContract(client, contract))),
    ...(await oneByOne(fills, async (fill) => readFill(reader, evm, fill))),
  ];
}
