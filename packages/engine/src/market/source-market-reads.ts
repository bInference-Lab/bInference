import type { MarketDataSource } from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import { callVenue } from "../venues/call-venue.js";
import type { MarketAnswer, MarketReadFailure } from "./market-answer.js";
import type { MarketReads } from "./ports.js";

/** What {@link createSourceMarketReads} reads from. */
export interface SourceMarketReadsOptions {
  /** The market data sources, asked in this order. */
  readonly sources: readonly MarketDataSource[];
  readonly clock: Clock;
  /** How long one source may take before it counts as down. */
  readonly timeoutMs: number;
}

type SourceRead<Item> = (
  source: MarketDataSource,
  signal: AbortSignal,
) => Promise<Result<readonly Item[], "not_covered">>;

// How far a read has come: the next source to ask, and whether one before it was down.
interface ReadState {
  readonly signal: AbortSignal;
  readonly index: number;
  readonly wasDown: boolean;
}

// Asks each source in turn under the timeout; the first that answers something wins. A source
// that throws, times out or never answers counts as down, as a venue does; an abort of the
// caller's own signal rejects with its reason.
async function firstAnswer<Item>(
  options: SourceMarketReadsOptions,
  read: SourceRead<Item>,
  state: ReadState,
): Promise<Result<MarketAnswer<Item>, MarketReadFailure>> {
  const { signal, index, wasDown } = state;
  signal.throwIfAborted();
  const source = options.sources[index];
  if (source === undefined) {
    return err(wasDown ? "source_down" : "no_data");
  }
  const call = { clock: options.clock, signal, timeoutMs: options.timeoutMs };
  const answer = await callVenue(async (bounded) => read(source, bounded), call);
  if (answer.ok && answer.value.ok && answer.value.value.length > 0) {
    return ok({ source: source.id, items: answer.value.value });
  }
  return await firstAnswer(options, read, {
    signal,
    index: index + 1,
    wasDown: wasDown || !answer.ok,
  });
}

/**
 * Creates the {@link MarketReads} over market data sources: each read asks the sources in order,
 * each under the timeout, and answers from the first that knows something. When none does, the
 * read is `source_down` if a source was down, else `no_data`.
 */
export function createSourceMarketReads(options: SourceMarketReadsOptions): MarketReads {
  return {
    pools: async (asset, { signal }) =>
      firstAnswer(options, async (source, bounded) => source.pools(asset, { signal: bounded }), {
        signal,
        index: 0,
        wasDown: false,
      }),
    trending: async (chain, { signal }) =>
      firstAnswer(options, async (source, bounded) => source.trending(chain, { signal: bounded }), {
        signal,
        index: 0,
        wasDown: false,
      }),
  };
}
