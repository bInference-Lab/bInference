import type { AssetRef, TxHash } from "@binference/chain";
import type { Address } from "viem";
import { erc20AssetRef, type EvmChain } from "../evm-chain.js";
import type { BlockFacts, BlockTransaction } from "./chain-block.schema.js";
import type { WalletTransfer } from "./wallet-transfers.js";

/** What reading a trade needs of its chain. */
export interface TradeContext {
  readonly chain: EvmChain;
  /** The chain's coin and the tokens with a Chainlink feed: what a buy spends and a sale gets. */
  readonly quotes: ReadonlySet<AssetRef>;
  /** The registry's venue of each contract, by address. */
  readonly venues: ReadonlyMap<Address, string>;
}

/** A wallet's net flow of one asset in one transaction. */
interface Flow {
  /** Base units: above 0 in, below 0 out. */
  readonly net: bigint;
  /** The token, for an ERC-20. */
  readonly token?: Address;
  /** The asset's first transfer log in the transaction; the transaction's first for the coin. */
  readonly firstLog: number;
}

/** One transaction of one tracked wallet: its net flow of each asset. */
export interface TradeGroup {
  readonly account: Address;
  readonly txHash: TxHash;
  readonly flows: ReadonlyMap<AssetRef, Flow>;
  /** The transaction's first transfer log of the wallet. */
  readonly firstLog: number;
  readonly venue?: string;
  /** The wallet sent one token and received nothing a log shows: it may have sold for the coin. */
  readonly takesNative: boolean;
  /** It called a venue and may have sold for the coin, but the coin received was not measured. */
  readonly isCoinUnmeasured?: true;
}

/** A trade as the logs and values read it, before its share and its value. */
export interface TradeDraft {
  readonly account: Address;
  readonly txHash: TxHash;
  readonly logIndex: number;
  readonly side: "buy" | "sell";
  readonly asset: AssetRef;
  readonly amount: bigint;
  readonly counterAsset: AssetRef;
  readonly counterAmount: bigint;
  readonly venue?: string;
  /** For a sale of a token: the token, whose holding before `logIndex` its share is of. */
  readonly soldToken?: Address;
}

function addFlow(flows: Map<AssetRef, Flow>, asset: AssetRef, flow: Flow): void {
  const before = flows.get(asset);
  flows.set(
    asset,
    before === undefined
      ? flow
      : {
          ...before,
          net: before.net + flow.net,
          firstLog: Math.min(before.firstLog, flow.firstLog),
        },
  );
}

function nonZero(flows: ReadonlyMap<AssetRef, Flow>): readonly (readonly [AssetRef, Flow])[] {
  return [...flows].filter(([, flow]) => flow.net !== 0n);
}

/** One wallet's transfers in one transaction, in log order. */
interface TxTransfers {
  readonly first: WalletTransfer;
  readonly all: readonly WalletTransfer[];
}

function groupOf(
  context: TradeContext,
  transfers: TxTransfers,
  sent: BlockTransaction | undefined,
): TradeGroup {
  const { first } = transfers;
  const { account, txHash } = first;
  const flows = new Map<AssetRef, Flow>();
  for (const { token, delta, logIndex } of transfers.all) {
    addFlow(flows, erc20AssetRef(context.chain, token), { net: delta, token, firstLog: logIndex });
  }
  if (sent?.from === account && sent.value > 0n) {
    addFlow(flows, context.chain.nativeAsset, { net: -sent.value, firstLog: first.logIndex });
  }
  const venue = sent?.to === undefined ? undefined : context.venues.get(sent.to);
  return {
    account,
    txHash,
    flows,
    firstLog: first.logIndex,
    takesNative: isOneTokenOut(flows),
    ...(venue === undefined ? {} : { venue }),
  };
}

// The wallet sent one token and nothing came in.
function isOneTokenOut(flows: ReadonlyMap<AssetRef, Flow>): boolean {
  const moved = nonZero(flows);
  return moved.length === 1 && moved.every(([, flow]) => flow.net < 0n && flow.token !== undefined);
}

/**
 * The tracked wallets' transactions in one block, each with its net flow of every asset (decision
 * 0249): the sums of its transfer logs, and the transaction's value when the wallet sent it.
 */
export function tradeGroupsOf(
  context: TradeContext,
  transfers: readonly WalletTransfer[],
  facts: BlockFacts,
): readonly TradeGroup[] {
  const byTx = new Map<string, TxTransfers>();
  for (const transfer of transfers) {
    const key = `${transfer.account}/${transfer.txHash}`;
    const known = byTx.get(key);
    byTx.set(key, { first: known?.first ?? transfer, all: [...(known?.all ?? []), transfer] });
  }
  const sent = new Map(facts.transactions.map((tx) => [tx.hash.toLowerCase(), tx]));
  return [...byTx.values()].map((group) =>
    groupOf(context, group, sent.get(group.first.txHash.toLowerCase())),
  );
}

/**
 * Adds the native coin each wallet received in the block to its transactions that may have sold
 * for it: those that called a venue the registry names when there are any, else all of them, in
 * equal parts, the rest to the first. A wallet whose received coin could not be measured
 * (`unknown`) gets 0 on such a transaction to a venue, so the sale is still read.
 */
export function withNativeReceived(
  context: TradeContext,
  groups: readonly TradeGroup[],
  received: ReadonlyMap<Address, bigint | "unknown">,
): readonly TradeGroup[] {
  const takers = new Map<Address, readonly TradeGroup[]>();
  for (const [account] of received) {
    const own = groups.filter((group) => group.account === account && group.takesNative);
    const atVenues = own.filter((group) => group.venue !== undefined);
    takers.set(account, atVenues.length > 0 ? atVenues : own);
  }
  return groups.map((group) => {
    const shared = takers.get(group.account) ?? [];
    const index = shared.indexOf(group);
    const total = received.get(group.account);
    if (index === -1 || total === undefined) {
      return group;
    }
    if (total === "unknown") {
      return group.venue === undefined ? group : { ...group, isCoinUnmeasured: true };
    }
    const part = total / BigInt(shared.length);
    const net = index === 0 ? total - part * BigInt(shared.length - 1) : part;
    if (net === 0n) {
      return group;
    }
    const flows = new Map(group.flows);
    flows.set(context.chain.nativeAsset, { net, firstLog: group.firstLog });
    return { ...group, flows };
  });
}

function draftOf(
  group: TradeGroup,
  side: TradeDraft["side"],
  legs: { readonly asset: readonly [AssetRef, Flow]; readonly counter: readonly [AssetRef, Flow] },
): TradeDraft {
  const [asset, flow] = legs.asset;
  const [counterAsset, counter] = legs.counter;
  const soldToken = side === "sell" ? flow.token : undefined;
  return {
    account: group.account,
    txHash: group.txHash,
    logIndex: flow.firstLog,
    side,
    asset,
    amount: flow.net < 0n ? -flow.net : flow.net,
    counterAsset,
    counterAmount: counter.net < 0n ? -counter.net : counter.net,
    ...(group.venue === undefined ? {} : { venue: group.venue }),
    ...(soldToken === undefined ? {} : { soldToken }),
  };
}

// A sale for the coin whose amount could not be measured: the token out, and the coin at 0.
function unmeasuredSale(context: TradeContext, group: TradeGroup): readonly TradeDraft[] {
  const [sold] = nonZero(group.flows);
  if (group.isCoinUnmeasured !== true || sold === undefined) {
    return [];
  }
  const coin: readonly [AssetRef, Flow] = [
    context.chain.nativeAsset,
    { net: 0n, firstLog: group.firstLog },
  ];
  return [draftOf(group, "sell", { asset: sold, counter: coin })];
}

/**
 * The trades of a block's transactions (decision 0249): one asset in and one out is a trade, and
 * the quote assets decide its side. A quote asset for a token is a buy of the token; a token for a
 * quote asset a sale of it; one token for another a sale of the first and a buy of the second; one
 * quote asset for another a buy of the one received. Anything else is no trade.
 */
export function tradesOf(
  context: TradeContext,
  groups: readonly TradeGroup[],
): readonly TradeDraft[] {
  return groups.flatMap((group): readonly TradeDraft[] => {
    const moved = nonZero(group.flows);
    const received = moved.filter(([, flow]) => flow.net > 0n);
    const spent = moved.filter(([, flow]) => flow.net < 0n);
    const [into] = received;
    const [out] = spent;
    if (received.length !== 1 || spent.length !== 1 || into === undefined || out === undefined) {
      return unmeasuredSale(context, group);
    }
    const isQuoteIn = context.quotes.has(into[0]);
    const isQuoteOut = context.quotes.has(out[0]);
    const buy = draftOf(group, "buy", { asset: into, counter: out });
    const sale = draftOf(group, "sell", { asset: out, counter: into });
    if (isQuoteIn === isQuoteOut) {
      return isQuoteIn ? [buy] : [sale, buy];
    }
    return isQuoteIn ? [sale] : [buy];
  });
}
