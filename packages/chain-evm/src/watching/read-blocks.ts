import type { AssetRef, ReadAnswer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockRead, ReadQuarantine } from "./price-batch.js";
import { quoteFeedReads } from "./quote-feeds.js";
import { type AggregateCall, readAggregate } from "./read-aggregate.js";
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

// Multicall3 hands every call all the gas left and takes no limit per call, so the batch is bounded
// as a whole: 1,000,000 a call, at most the 50,000,000 that geth and its forks allow a call by
// default (decision 0194).
const gasPerCall = 1_000_000n;
const maxBatchGas = 50_000_000n;

// Faults a node answers about the batch itself, which a call in it may have caused.
const batchFaults: ReadonlySet<string> = new Set(["chain.rpc_error", "chain.multicall_mismatch"]);

async function ask(
  reader: BlockReader,
  calls: readonly AggregateCall[],
  block: bigint,
): Promise<readonly ReadAnswer[]> {
  const gas = BigInt(calls.length + 1) * gasPerCall;
  return readAggregate(reader.rpc, {
    multicall: reader.multicall,
    calls,
    block,
    signal: reader.signal,
    atHead: true,
    gas: gas < maxBatchGas ? gas : maxBatchGas,
    ...(reader.timeoutMs === undefined ? {} : { timeoutMs: reader.timeoutMs }),
    ...(reader.preferEndpoint === undefined ? {} : { preferEndpoint: reader.preferEndpoint }),
  });
}

/** Tokens read apart: each with its answers, and the ones whose calls fail any batch. */
interface Isolated {
  readonly tokens: BlockRead["tokens"];
  readonly quarantined: readonly ReadQuarantine[];
}

// Reads a group of tokens at one block, and, when the node refuses the group's batch, each half
// apart at the same block, down to the single tokens whose calls the node refuses.
async function isolate(
  reader: BlockReader,
  group: readonly PlannedToken[],
  block: bigint,
): Promise<Isolated> {
  try {
    const answers = await ask(
      reader,
      group.flatMap(({ calls }) => calls),
      block,
    );
    return { tokens: splitAnswers(group, answers).tokens, quarantined: [] };
  } catch (error) {
    if (!(error instanceof BinferenceError) || !batchFaults.has(error.code)) {
      throw error;
    }
    const [only] = group;
    if (group.length === 1 && only !== undefined) {
      return { tokens: [], quarantined: [{ token: only.token, block, code: error.code }] };
    }
    const middle = Math.ceil(group.length / 2);
    const halves = await Promise.all([
      isolate(reader, group.slice(0, middle), block),
      isolate(reader, group.slice(middle), block),
    ]);
    return {
      tokens: halves.flatMap(({ tokens }) => tokens),
      quarantined: halves.flatMap(({ quarantined }) => quarantined),
    };
  }
}

// One batch for every planned token and the feeds of their quote assets, at one block. A batch the
// node refuses is read again at the same block: the feeds alone, which a refusal too shows to be
// the node's fault and no call's, then the tokens in halves, so the calls that fail it leave it.
async function readWhole(
  reader: BlockReader,
  planned: readonly PlannedToken[],
  block: bigint,
): Promise<BlockRead> {
  const feeds = quoteFeedReads(
    reader.feeds,
    planned.map(({ quoteAsset }) => quoteAsset),
  );
  try {
    const answers = await ask(
      reader,
      [...planned.flatMap(({ calls }) => calls), ...feeds.calls],
      block,
    );
    const { tokens, rest } = splitAnswers(planned, answers);
    return { block, tokens, feeds, feedAnswers: rest, quarantined: [] };
  } catch (error) {
    if (!(error instanceof BinferenceError) || !batchFaults.has(error.code)) {
      throw error;
    }
    const feedAnswers = await ask(reader, feeds.calls, block);
    const { tokens, quarantined } = await isolate(reader, planned, block);
    return { block, tokens, feeds, feedAnswers, quarantined };
  }
}

async function readOne(
  reader: BlockReader,
  planned: readonly PlannedToken[],
  block: bigint,
): Promise<BlockOutcome> {
  try {
    return { kind: "read", read: await readWhole(reader, planned, block) };
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
 * before an earlier one. A token whose calls fail a block's whole batch leaves that block's read,
 * `quarantined`, and the other tokens are priced without it. Rejects on a fault of its own, or with the signal's reason once it aborts.
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
