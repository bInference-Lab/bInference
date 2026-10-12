import type { MarketDataSource } from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import { callVenue } from "../venues/call-venue.js";
import type { MarketAnswer, MarketReadFailure } from "./market-answer.js";
import type { MarketReads } from "./ports.js";

/** What {@link createSourceMarketReads} reads from. */
export interface SourceMarketReadsOptions {
  /** The market data sources asked for pools and trending tokens, in this order. */
  readonly sources: readonly MarketDataSource[];
  /**
   * The sources asked for candles, in this order; one that reads no candles is never asked.
   * Those of `sources` that read candles when absent.
   */
  readonly chartSources?: readonly MarketDataSource[];
  readonly clock: Clock;
  /** How long one source may take before it counts as down. */
  readonly timeoutMs: number;
}

type SourceRead<Source, Item> = (
  source: Source,
  signal: AbortSignal,
) => Promise<Result<readonly Item[], "not_covered">>;

/** A source that reads candles, its read in hand. */
interface ChartSource {
  readonly id: string;
  readonly candles: NonNullable<MarketDataSource["candles"]>;
}

// The sources that read candles, in order; the others are never asked for a chart.
const chartSourcesOf = (sources: readonly MarketDataSource[]): readonly ChartSource[] =>
  sources.flatMap(({ id, candles }) => (candles === undefined ? [] : [{ id, candles }]));

// The sources one kind of read asks, in order, and how long each may take.
interface AskOptions<Source> {
  readonly sources: readonly Source[];
  readonly clock: Clock;
  readonly timeoutMs: number;
}

// How far a read has come: the next source to ask, and whether one before it was down.
interface ReadState {
  readonly signal: AbortSignal;
  readonly index: number;
  readonly wasDown: boolean;
}

// Asks each source in turn under the timeout; the first that answers something wins. A source
// that throws, times out or never answers counts as down, as a venue does; an abort of the
// caller's own signal rejects with its reason.
async function firstAnswer<Source extends { readonly id: string }, Item>(
  options: AskOptions<Source>,
  read: SourceRead<Source, Item>,
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

const start = (signal: AbortSignal): ReadState => ({ signal, index: 0, wasDown: false });

/**
 * Creates the {@link MarketReads} over market data sources: each read asks the sources that serve
 * it in order, each under the timeout, and answers from the first that knows something. When none
 * does, the read is `source_down` if a source was down, else `no_data`. A chart asks only sources
 * that read candles.
 */
export function createSourceMarketReads(options: SourceMarketReadsOptions): MarketReads {
  const { clock, timeoutMs } = options;
  const charting = chartSourcesOf(options.chartSources ?? options.sources);
  const chartOptions = { sources: charting, clock, timeoutMs };
  return {
    pools: async (asset, { signal }) =>
      firstAnswer(
        options,
        async (source, bounded) => source.pools(asset, { signal: bounded }),
        start(signal),
      ),
    trending: async (chain, { signal }) =>
      firstAnswer(
        options,
        async (source, bounded) => source.trending(chain, { signal: bounded }),
        start(signal),
      ),
    chart: async (asset, request, { signal }) =>
      firstAnswer(
        chartOptions,
        async (source, bounded) => source.candles(asset, request, { signal: bounded }),
        start(signal),
      ),
  };
}
