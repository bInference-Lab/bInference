import { type ChainRegistry, type TokenRiskSource, type TxSimulator } from "@binference/chain";
import { type Clock, createDeadline, type Random } from "@binference/core";
import type { RiskView } from "@binference/protocol";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { RiskCacheStore, RiskCheck } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
import { cachedRiskSource } from "./cached-risk-source.js";
import type { RiskAssessment, RiskSubject } from "./risk-assessment.js";
import { riskVerdict, type SourceAnswer } from "./risk-verdict.js";
import { probeRoundTrip, type RoundTrip } from "./round-trip.js";

/** A risk source the check asks, and whether a token needs its report to pass. */
export interface RiskSourceUse {
  readonly source: TokenRiskSource;
  readonly isRequired: boolean;
}

/** What the risk check runs on. */
export interface RiskCheckOptions {
  readonly sources: readonly RiskSourceUse[];
  /** Keeps each source's report for `cacheTtlMs`. */
  readonly cache: RiskCacheStore;
  readonly cacheTtlMs: number;
  /** How long one source may take to answer before it counts as down. */
  readonly sourceTimeoutMs: number;
  /** Builds the round trip's legs on the trade's own venue. */
  readonly host: VenueHost;
  /** Runs the round trip's legs unsent, on the chain's latest state. */
  readonly simulator: TxSimulator;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  /** Where each round trip's fresh accounts come from. */
  readonly random: Random;
}

interface Call {
  readonly subject: RiskSubject;
  readonly signal: AbortSignal;
}

async function answerOf(
  use: RiskSourceUse,
  options: RiskCheckOptions,
  call: Call,
): Promise<SourceAnswer> {
  const { source, isRequired } = use;
  const { clock, sourceTimeoutMs: timeoutMs } = options;
  const deadline = createDeadline({ clock, signal: call.signal, timeoutMs });
  try {
    const asset = call.subject.quoted.trade.assetOut;
    const answer = await source.check(asset, { signal: deadline.signal });
    return answer.ok
      ? { id: source.id, isRequired, outcome: "reported", report: answer.value }
      : { id: source.id, isRequired, outcome: "not_covered" };
  } catch {
    call.signal.throwIfAborted();
    return { id: source.id, isRequired, outcome: "down" };
  } finally {
    deadline.clear();
  }
}

async function roundTripOf(options: RiskCheckOptions, call: Call): Promise<RoundTrip> {
  try {
    return await probeRoundTrip(call.subject.quoted, options, call.signal);
  } catch {
    call.signal.throwIfAborted();
    return { kind: "unavailable" };
  }
}

function verifiedView(checkedAt: number): RiskView {
  return { verdict: "pass", flags: [], onCurve: false, checkedAt };
}

// Every source answers through the risk cache.
function cachedUses(options: RiskCheckOptions): readonly RiskSourceUse[] {
  const cache = { store: options.cache, clock: options.clock, ttlMs: options.cacheTtlMs };
  return options.sources.map((use) => ({ ...use, source: cachedRiskSource(use.source, cache) }));
}

async function assess(options: RiskCheckOptions, call: Call): Promise<RiskAssessment> {
  call.signal.throwIfAborted();
  const { quoted, limits } = call.subject;
  if (assetInfoOf(options.chains, quoted.trade.assetOut) !== undefined) {
    return { view: verifiedView(options.clock.now()) };
  }
  const [answers, roundTrip] = await Promise.all([
    Promise.all(options.sources.map(async (use) => answerOf(use, options, call))),
    roundTripOf(options, call),
  ]);
  return riskVerdict({ answers, roundTrip, limits, checkedAtMs: options.clock.now() });
}

/**
 * Creates the engine's {@link RiskCheck}. A trade that buys a token the chain registry lists, or
 * the native coin, passes without asking anyone. For any other token it asks every source, each
 * through the risk cache and under its own timeout, while it runs the round trip from fresh
 * accounts, then weighs both (see `riskVerdict`). A source that fails, times out or has no answer
 * counts as such, never as a throw; only an abort of the caller's signal rejects.
 */
export function createRiskCheck(options: RiskCheckOptions): RiskCheck {
  const cached = { ...options, sources: cachedUses(options) };
  return {
    assess: async (subject, { signal }) => assess(cached, { subject, signal }),
  };
}
