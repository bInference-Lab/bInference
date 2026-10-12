import type { AssetRef, ReadAnswer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockRead } from "./price-batch.js";
import { quoteFeedReads } from "./quote-feeds.js";
import { readAggregate } from "./read-aggregate.js";
import type { PlannedToken } from "./watch-list.js";

/** What a watcher reads its blocks' batches with. */
export interface BlockReader {
  readonly rpc: RpcFailover;
  /** Multicall3 on the chain. */
  readonly multicall: Address;
  /** The quote assets' Chainlink feeds by asset. */
  readonly feeds: ReadonlyMap<AssetRef, FeedAsset>;
  /** How long one endpoint may take; the failover's own timeout when absent. */
  readonly timeoutMs?: number;
  /** The endpoint to ask first: the one whose poll announced the head. */
  readonly preferEndpoint?: string;
  readonly signal: AbortSignal;
}

/** How one block's read ended: read, failed with a fault's code, or ahead of every node. */
export type BlockOutcome =
  | { readonly kind: "read"; readonly read: BlockRead }
  | { readonly kind: "failed"; readonly code: string }
  | { readonly kind: "not_yet" };

// Hands each token its own answers out of the batch's, in the batch's order.
function splitAnswers(
  planned: readonly PlannedToken[],
  answers: readonly ReadAnswer[],
): { readonly tokens: BlockRead["tokens"]; readonly rest: readonly ReadAnswer[] } {
  let offset = 0;
  const tokens = planned.map((token) => {
    const own = answers.slice(offset, offset + token.calls.length);
    offset += token.calls.length;
    return { planned: token, answers: own };
  });
  return { tokens, rest: answers.slice(offset) };
}

// One batch for every planned token and the feeds of their quote assets, at one block.
async function readOne(
  reader: BlockReader,
  planned: readonly PlannedToken[],
  block: bigint,
): Promise<BlockOutcome> {
  const feeds = quoteFeedReads(
    reader.feeds,
    planned.map(({ quoteAsset }) => quoteAsset),
  );
  const calls = [...planned.flatMap((token) => token.calls), ...feeds.calls];
  try {
    const answers = await readAggregate(reader.rpc, {
      multicall: reader.multicall,
      calls,
      block,
      signal: reader.signal,
      atHead: true,
      ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
      ...(reader.preferEndpoint === undefined ? {} : { preferEndpoint: reader.preferEndpoint }),
    });
    const { tokens, rest } = splitAnswers(planned, answers);
    return { kind: "read", read: { block, tokens, feeds, feedAnswers: rest } };
  } catch (error) {
    reader.signal.throwIfAborted();
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    return error.code === "chain.block_ahead"
      ? { kind: "not_yet" }
      : { kind: "failed", code: error.code };
  }
}

/**
 * Reads the batches of several blocks at once, each its own `eth_call` sent together, so a
 * watcher behind the head catches up in one round trip (decision 0194). Answers the outcomes in
 * block order, up to and with the first that was not read: a later block is never handed on
 * before an earlier one. Rejects on a fault of its own, or with the signal's reason once it aborts.
 */
export async function readBlocks(
  reader: BlockReader,
  planned: readonly PlannedToken[],
  blocks: readonly bigint[],
): Promise<readonly BlockOutcome[]> {
  const outcomes = await Promise.all(blocks.map(async (block) => readOne(reader, planned, block)));
  const stop = outcomes.findIndex(({ kind }) => kind !== "read");
  return stop === -1 ? outcomes : outcomes.slice(0, stop + 1);
}
