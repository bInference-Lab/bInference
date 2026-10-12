import {
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type MarketDataSource,
} from "@binference/chain";
import { BinferenceError, type Clock, type Ratio } from "@binference/core";
import { z } from "zod";

/** A watcher's latest price of a token, as the cross-check compares it. */
export interface PriceSample {
  readonly token: AssetRef;
  /** Micro-dollars for one base unit of the token. */
  readonly usdPrice: Ratio;
  /** The token's decimals: one whole token is 10 to this power base units. */
  readonly decimals: number;
  /** What priced it, such as the watcher's plan, which its check carries. */
  readonly plan?: string;
  /** Checked first in each source's next round, such as a price from a pool not yet proven. */
  readonly isUrgent?: boolean;
}

/** How a data source's price for a token compared with the watcher's at its last check. */
export interface PriceCheck {
  readonly token: AssetRef;
  /** The data source's id. */
  readonly source: string;
  /** How far the watcher's price was from the source's, in basis points of the source's. */
  readonly gapBps: number;
  /** Whether the gap reached the cross-check's limit. */
  readonly isGap: boolean;
  readonly atMs: number;
  /** What priced the watcher's price it compared: its sample's plan. */
  readonly plan?: string;
}

/** A data source the cross-check asks, how often, and for how many tokens a round at most. */
export interface CrossCheckSource {
  readonly source: MarketDataSource;
  readonly everyMs: number;
  readonly maxTokens: number;
}

/** What the cross-check compares, with what, and where its findings go. */
export interface PriceCrossCheckOptions {
  readonly sources: readonly CrossCheckSource[];
  /** The watcher's latest prices now. */
  readonly samples: () => readonly PriceSample[];
  /** The tokens watched now; the checks of any other are forgotten. */
  readonly watched: () => readonly AssetRef[];
  /** The gap, in basis points, at which a price is flagged. */
  readonly gapLimitBps: number;
  readonly clock: Clock;
  /** Hears each token whose price newly reached the limit against a source. */
  readonly onGap: (check: PriceCheck) => void;
  /**
   * Hears a source that could not be read in a round, with its error code: a fault, or
   * `market.not_covered` for a chain it does not serve.
   */
  readonly onSourceFailed: (source: string, errorCode: string) => void;
}

/** Compares the watcher's prices with the data sources' on a schedule, never once a block. */
export interface PriceCrossCheck {
  /**
   * Runs each source whose time has come: its urgent tokens first, then those checked longest ago,
   * at most its `maxTokens`, in one price read per chain, after forgetting the checks of tokens no
   * longer watched. A source that fails, or does not serve a chain, is heard and asked again at
   * its next time. Rejects with the signal's reason once it aborts.
   */
  tick(options: { readonly signal: AbortSignal }): Promise<void>;
  /** The last check of each token against each source, flagged or not. */
  checks(): readonly PriceCheck[];
  /** Whether a token's last check against any source reached the limit. */
  hasGap(token: AssetRef): boolean;
}

const microsPerDollar = 1_000_000n;
const wholeBps = 10_000n;
// A gap past this many basis points, 100 times the price, reads as that.
const maxGapBps = 1_000_000n;
const bpsNumber = z.bigint().pipe(z.coerce.number()).pipe(z.int().nonnegative());

/**
 * The gap between the watcher's price and a source's, in basis points of the source's, rounded
 * down: the watcher's micro-dollars per base unit, times 10^decimals, against the source's
 * dollars per whole token.
 */
export function gapBpsOf(sample: PriceSample, sourceUsd: Ratio): bigint {
  const scale = 10n ** BigInt(sample.decimals);
  const watched = sample.usdPrice.numerator * scale * sourceUsd.denominator;
  const listed = sourceUsd.numerator * microsPerDollar * sample.usdPrice.denominator;
  const apart = watched > listed ? watched - listed : listed - watched;
  const gap = listed === 0n ? maxGapBps : (apart * wholeBps) / listed;
  return gap > maxGapBps ? maxGapBps : gap;
}

function chainsOf(samples: readonly PriceSample[]): ReadonlySet<ChainRef> {
  return new Set(samples.map(({ token }) => assetRefParts(token).chain));
}

function samplesOn(samples: readonly PriceSample[], chain: ChainRef): readonly PriceSample[] {
  return samples.filter(({ token }) => assetRefParts(token).chain === chain);
}

/** One source's round on one chain: the samples to compare, and the round's signal. */
interface ChainRound {
  readonly source: MarketDataSource;
  readonly chain: ChainRef;
  readonly samples: readonly PriceSample[];
  readonly signal: AbortSignal;
}

/** What the cross-check keeps: each token's last check against each source, and when to ask next. */
interface CheckBook {
  readonly checks: Map<string, PriceCheck>;
  readonly nextAtMs: Map<string, number>;
}

const keyOf = (source: string, token: AssetRef): string => `${source} ${token}`;

function record(
  book: CheckBook,
  options: PriceCrossCheckOptions,
  found: { readonly source: string; readonly sample: PriceSample; readonly sourceUsd: Ratio },
): void {
  const { source, sample } = found;
  const gapBps = bpsNumber.parse(gapBpsOf(sample, found.sourceUsd));
  const isGap = gapBps >= options.gapLimitBps;
  const wasGap = book.checks.get(keyOf(source, sample.token))?.isGap === true;
  const check: PriceCheck = {
    token: sample.token,
    source,
    gapBps,
    isGap,
    atMs: options.clock.now(),
    ...(sample.plan === undefined ? {} : { plan: sample.plan }),
  };
  book.checks.set(keyOf(source, sample.token), check);
  if (isGap && !wasGap) {
    options.onGap(check);
  }
}

async function readChain(
  book: CheckBook,
  options: PriceCrossCheckOptions,
  round: ChainRound,
): Promise<void> {
  const tokens = round.samples.map(({ token }) => token);
  const prices = await round.source.prices?.(round.chain, tokens, { signal: round.signal });
  if (prices === undefined) {
    return;
  }
  if (!prices.ok) {
    options.onSourceFailed(round.source.id, `market.${prices.error}`);
    return;
  }
  for (const sample of round.samples) {
    const sourceUsd = prices.value.get(sample.token);
    if (sourceUsd !== undefined && sourceUsd.numerator > 0n && sourceUsd.denominator > 0n) {
      record(book, options, { source: round.source.id, sample, sourceUsd });
    }
  }
}

async function runSource(
  book: CheckBook,
  options: PriceCrossCheckOptions,
  run: { readonly item: CrossCheckSource; readonly signal: AbortSignal },
): Promise<void> {
  const { item, signal } = run;
  const { source } = item;
  book.nextAtMs.set(source.id, options.clock.now() + item.everyMs);
  const checkedAt = (token: AssetRef): number =>
    book.checks.get(keyOf(source.id, token))?.atMs ?? -1;
  // Urgent samples first, then the ones checked longest ago.
  const orderOf = (sample: PriceSample): number =>
    sample.isUrgent === true ? -2 : checkedAt(sample.token);
  const samples = options
    .samples()
    .toSorted((left, right) => orderOf(left) - orderOf(right))
    .slice(0, item.maxTokens);
  try {
    await Promise.all(
      [...chainsOf(samples)].map(async (chain) =>
        readChain(book, options, { source, chain, samples: samplesOn(samples, chain), signal }),
      ),
    );
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.onSourceFailed(source.id, errorCode);
  }
}

// A token no longer watched leaves the book, so a stale gap never outlives its watch.
function forgetUnwatched(book: CheckBook, watched: readonly AssetRef[]): void {
  const kept = new Set(watched);
  for (const [key, check] of book.checks) {
    if (!kept.has(check.token)) {
      book.checks.delete(key);
    }
  }
}

/** Creates the {@link PriceCrossCheck}, which keeps what it found in memory only. */
export function createPriceCrossCheck(options: PriceCrossCheckOptions): PriceCrossCheck {
  const book: CheckBook = { checks: new Map(), nextAtMs: new Map() };
  return {
    async tick({ signal }) {
      signal.throwIfAborted();
      forgetUnwatched(book, options.watched());
      const nowMs = options.clock.now();
      const due = options.sources.filter(
        (item) =>
          item.source.prices !== undefined && (book.nextAtMs.get(item.source.id) ?? 0) <= nowMs,
      );
      await Promise.all(due.map(async (item) => runSource(book, options, { item, signal })));
    },
    checks: () => [...book.checks.values()],
    hasGap: (token) =>
      [...book.checks.values()].some((check) => check.token === token && check.isGap),
  };
}
