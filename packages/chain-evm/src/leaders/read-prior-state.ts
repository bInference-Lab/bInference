import type { AssetRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type Address, encodeFunctionData, erc20Abi, type Hex } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { quoteFeedReads } from "../watching/quote-feeds.js";
import { readAggregate } from "../watching/read-aggregate.js";
import { batchGasOf } from "../watching/read-isolated.js";
import type { PriorState } from "./finish-trades.js";

/** What the state before a block is read with. */
export interface PriorReader {
  readonly rpc: RpcFailover;
  /** Multicall3 on the chain. */
  readonly multicall: Address;
  /** The quote assets' Chainlink feeds by asset. */
  readonly feeds: ReadonlyMap<AssetRef, FeedAsset>;
  /** How long one endpoint may take; the failover's own timeout when absent. */
  readonly timeoutMs?: number;
  readonly signal: AbortSignal;
}

/** What to read at the block before a block of trades. */
export interface PriorQuery {
  /** The block of the trades: the state read is the one before it. */
  readonly block: bigint;
  /** The block's time, which the feeds' answers are judged stale against. */
  readonly atMs: number;
  /** The wallets' tokens whose holdings the sales' shares need. */
  readonly holdings: readonly { readonly account: Address; readonly token: Address }[];
  /** The assets on the trades' quote sides. */
  readonly quotes: readonly AssetRef[];
}

const noState: PriorState = { holding: () => undefined, prices: new Map() };
const wordAnswer = /^0x[0-9a-fA-F]{64}$/;

function keyOf(account: Address, token: Address): string {
  return `${account}/${token}`;
}

function amountOf(answer: Hex | undefined): bigint | undefined {
  return answer !== undefined && wordAnswer.test(answer) ? BigInt(answer) : undefined;
}

/**
 * Reads, in one Multicall3 call at the block before `query.block`, the wallets' holdings the
 * sales' shares need and the quote assets' Chainlink feeds (decision 0249). A call that fails
 * leaves its holding or its price out; once no endpoint holds that state, it answers none of them,
 * and the trades are kept without a share or a value. Rejects on any other fault, and with the
 * signal's reason once it aborts.
 */
export async function readPriorState(reader: PriorReader, query: PriorQuery): Promise<PriorState> {
  const holdings = [
    ...new Map(query.holdings.map((item) => [keyOf(item.account, item.token), item])).values(),
  ];
  const feeds = quoteFeedReads(reader.feeds, query.quotes);
  const balanceCalls = holdings.map(({ account, token }) => ({
    target: token,
    callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  }));
  const calls = [...balanceCalls, ...feeds.calls];
  if (calls.length === 0 || query.block === 0n) {
    return noState;
  }
  try {
    const answers = await readAggregate(reader.rpc, {
      multicall: reader.multicall,
      calls,
      block: query.block - 1n,
      signal: reader.signal,
      gas: batchGasOf(calls.length),
      ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
    });
    const held = new Map(
      holdings.map(({ account, token }, index) => [
        keyOf(account, token),
        amountOf(answers[index]),
      ]),
    );
    return {
      holding: (account, token) => held.get(keyOf(account, token)),
      prices: feeds.usdPrices(answers.slice(balanceCalls.length), query.atMs),
    };
  } catch (error) {
    reader.signal.throwIfAborted();
    if (error instanceof BinferenceError && error.code === "chain.state_missing") {
      return noState;
    }
    throw error;
  }
}
