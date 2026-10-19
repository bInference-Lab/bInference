import type { AccountRef } from "@binference/chain";
import { type Address, type Hex, toHex } from "viem";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import { requestResult } from "../rpc/request-result.js";
import { accountAddressOn } from "../sending/account-address-on.js";
import { readNativeReceived } from "../sending/read-native-received.js";
import { type BlockFacts, blockFactsSchema } from "./chain-block.schema.js";
import { finishTrades, type WalletTrade } from "./finish-trades.js";
import type { LeaderReader } from "./leader-reader.js";
import {
  type TradeDraft,
  type TradeGroup,
  tradeGroupsOf,
  tradesOf,
  withNativeReceived,
} from "./match-trades.js";
import { readPriorState } from "./read-prior-state.js";
import { readSpanLogs } from "./read-span-logs.js";
import { type WalletOverflow, type WalletTransfer, walletTransfersOf } from "./wallet-transfers.js";

/** A tracked wallet in a read, and the first block its trades are read from. */
export interface SpanWallet {
  readonly account: AccountRef;
  /** The first block read of the wallet since it was tracked. */
  readonly sinceBlock: bigint;
  /** The first block of this read the wallet's trades are taken from: none before is new. */
  readonly readFrom: bigint;
}

/** A tracked wallet's block the budget cut (decision 0250). */
export interface LeaderOverflow {
  readonly account: AccountRef;
  readonly block: bigint;
  /** Its transfers in the block; absent when the endpoint refused to answer them. */
  readonly transfers?: number;
}

/** What one read of the leader watcher found, from `from` to `to`, both included. */
export interface LeaderRead {
  readonly from: bigint;
  readonly to: bigint;
  /** The hash of block `to`, where the next read goes on from. */
  readonly toHash: Hex;
  readonly wallets: readonly SpanWallet[];
  /** In block and log order. */
  readonly trades: readonly WalletTrade[];
  readonly overflows: readonly LeaderOverflow[];
}

/** The blocks of one read and the wallets read in them. */
export interface LeaderSpan {
  readonly from: bigint;
  readonly to: bigint;
  readonly toHash: Hex;
  readonly wallets: readonly SpanWallet[];
}

// A wallet with more transfers than this in one block makes no trade to follow (decision 0250).
const maxTransfersPerBlock = 100;

// A node that answered the block's logs and then answers no block fails the schema, and the
// next endpoint is asked.
async function readFacts(reader: LeaderReader, block: bigint): Promise<BlockFacts> {
  return requestResult(reader.rpc, {
    method: "eth_getBlockByNumber",
    params: [toHex(block), true],
    result: blockFactsSchema,
    signal: reader.signal,
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
  });
}

// The coin each wallet that may have sold for it received in the block (decision 0108).
async function coinReceived(
  reader: LeaderReader,
  groups: readonly TradeGroup[],
  block: bigint,
): Promise<ReadonlyMap<Address, bigint | "unknown">> {
  const accounts = [...new Set(groups.filter((group) => group.takesNative).map((g) => g.account))];
  const source = {
    rpc: reader.rpc,
    chain: reader.context.chain,
    ...(reader.tracer === undefined ? {} : { tracer: reader.tracer }),
  };
  const amounts = await Promise.all(
    accounts.map(async (address) => {
      const account = evmAccountRef(reader.context.chain, address);
      const read = await readNativeReceived(source, { account, block }, reader.signal);
      return [address, read.ok ? read.value : "unknown"] as const;
    }),
  );
  return new Map(amounts);
}

function sold(drafts: readonly TradeDraft[]) {
  return drafts.flatMap(({ account, soldToken: token }) =>
    token === undefined ? [] : [{ account, token }],
  );
}

async function blockTrades(
  reader: LeaderReader,
  block: bigint,
  transfers: readonly WalletTransfer[],
): Promise<readonly WalletTrade[]> {
  const { context } = reader;
  const facts = await readFacts(reader, block);
  const groups = tradeGroupsOf(context, transfers, facts);
  const received = await coinReceived(reader, groups, block);
  const drafts = tradesOf(context, withNativeReceived(context, groups, received));
  if (drafts.length === 0) {
    return [];
  }
  const prior = await readPriorState(reader, {
    block,
    atMs: facts.timestampMs,
    holdings: sold(drafts),
    quotes: drafts.map(({ counterAsset }) => counterAsset),
  });
  return finishTrades(context.chain, { header: facts, transfers, drafts }, prior);
}

function overflowOf(chain: EvmChain, cut: WalletOverflow): LeaderOverflow {
  const account = evmAccountRef(chain, cut.account);
  const { block, transfers } = cut;
  return transfers === undefined ? { account, block } : { account, block, transfers };
}

function byBlock(transfers: readonly WalletTransfer[]): ReadonlyMap<bigint, WalletTransfer[]> {
  const blocks = new Map<bigint, WalletTransfer[]>();
  for (const transfer of transfers) {
    blocks.set(transfer.block, [...(blocks.get(transfer.block) ?? []), transfer]);
  }
  return blocks;
}

/**
 * Reads one span of blocks for the tracked wallets (decisions 0249 and 0250): their transfers in
 * two log queries, each block with a transfer once with its transactions, and from them each
 * wallet's trades, once per transaction, with the shares of its sales and their values. A
 * wallet's transfers before its `readFrom` are left out, so no block is read twice for it. Rejects on a fault, so the caller reads
 * the span again, and with the signal's reason once it aborts.
 */
export async function readLeaderSpan(reader: LeaderReader, span: LeaderSpan): Promise<LeaderRead> {
  const { chain } = reader.context;
  const readFrom = new Map(
    span.wallets.map((wallet) => [accountAddressOn(chain, wallet.account), wallet.readFrom]),
  );
  const logReader = {
    rpc: reader.logsRpc,
    signal: reader.signal,
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
  };
  const read = await readSpanLogs(logReader, {
    from: span.from,
    to: span.to,
    addresses: [...readFrom.keys()],
    ...(span.from === span.to ? { blockHash: span.toHash } : {}),
  });
  const found = walletTransfersOf(read.logs, new Set(readFrom.keys()), maxTransfersPerBlock);
  const isRead = ({ account, block }: { readonly account: Address; readonly block: bigint }) =>
    block >= (readFrom.get(account) ?? block);
  const transfers = found.transfers.filter(isRead);
  const blocks = [...byBlock(transfers)];
  const trades = await Promise.all(
    blocks.map(async ([block, own]) => blockTrades(reader, block, own)),
  );
  const overflows = [...found.overflows, ...read.refused]
    .filter(isRead)
    .map((cut) => overflowOf(chain, cut));
  return { ...span, trades: trades.flat(), overflows };
}
