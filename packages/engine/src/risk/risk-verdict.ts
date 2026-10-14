import type { AccountRef, RiskFlagCode, TokenRiskReport } from "@binference/chain";
import type { Bps } from "@binference/core";
import type { RiskFlag, RiskView } from "@binference/protocol";
import type { RiskReason } from "../intents/intent-reason.js";
import type { RiskAssessment, RiskLimits } from "./risk-assessment.js";
import type { RoundTrip } from "./round-trip.js";

/** One risk source's answer for the token: its report, or that it was down or had none. */
export type SourceAnswer = {
  readonly id: string;
  /** A token passes only with a report from every required source. */
  readonly isRequired: boolean;
} & (
  | { readonly outcome: "reported"; readonly report: TokenRiskReport }
  | { readonly outcome: "down" | "not_covered" }
);

/** Everything the verdict weighs. */
export interface RiskFindings {
  readonly answers: readonly SourceAnswer[];
  readonly roundTrip: RoundTrip;
  readonly limits: RiskLimits;
  readonly checkedAtMs: number;
  /** The launch-window tax the trade's own quote names for its wallet now (decision 0213). */
  readonly snipeTaxBps?: Bps;
  /** What the trade's quote says its route's pool hooks keep of it (decisions 0214 and 0215). */
  readonly hookFeeBps?: Bps;
  /** The wallets the token's launchpad favors, which the view records (decision 0213). */
  readonly insiders?: readonly AccountRef[];
}

// The source the engine's own round trip reports its findings as, as the risk cache names it.
const simulationSource = "simulation";

type Check = (findings: RiskFindings, flags: ReadonlySet<RiskFlagCode>) => boolean;

function reportsOf(answers: readonly SourceAnswer[]): readonly TokenRiskReport[] {
  return answers.flatMap((answer) => (answer.outcome === "reported" ? [answer.report] : []));
}

function highestTaxBps(roundTrip: RoundTrip): Bps | undefined {
  return roundTrip.kind === "measured"
    ? [roundTrip.buyTaxBps, roundTrip.transferTaxBps, roundTrip.sellTaxBps].reduce((max, tax) =>
        tax > max ? tax : max,
      )
    : undefined;
}

// The highest tax a leg pays, the buy counting the fee its route's pool hooks keep once: the
// quote's or the share measured going to them, the higher (decision 0215).
function countedTaxBps(roundTrip: RoundTrip, hookFeeBps: Bps | undefined): number {
  if (roundTrip.kind !== "measured") {
    return 0;
  }
  const hooks = Math.max(hookFeeBps ?? 0, roundTrip.hookFeeBps);
  return Math.max(roundTrip.buyTaxBps + hooks, roundTrip.transferTaxBps, roundTrip.sellTaxBps);
}

// Each source counts only the pools it knows, so the largest figure is the best floor. With no
// figure from a source that answered, the token has no pool any source knows of.
function liquidityOf(answers: readonly SourceAnswer[]): bigint | undefined {
  return reportsOf(answers).reduce<bigint | undefined>((max, report) => {
    const liquidity = report.liquidityUsdMicros;
    return liquidity !== undefined && (max === undefined || liquidity > max) ? liquidity : max;
  }, undefined);
}

// What the round trip names a leg the token refused as, in the view.
const refusedLegCodes = { sell: "cannot_sell", transfer: "transfer_blocked" } as const;

const isRefused = (roundTrip: RoundTrip, leg: "transfer" | "sell"): boolean =>
  roundTrip.kind === "refused" && roundTrip.leg === leg;

// Spec 6's risk reasons in its order: the first that holds is the one the intent stores.
const checks: readonly (readonly [RiskReason, Check])[] = [
  ["honeypot", (_findings, flags) => flags.has("honeypot")],
  [
    "cannot_sell",
    ({ roundTrip }, flags) => flags.has("cannot_sell") || isRefused(roundTrip, "sell"),
  ],
  [
    "hidden_owner",
    (_findings, flags) => flags.has("hidden_owner") && flags.has("owner_changes_balances"),
  ],
  ["snipe_tax", ({ snipeTaxBps, limits }) => (snipeTaxBps ?? 0) > limits.maxTaxBps],
  [
    "high_tax",
    ({ roundTrip, limits, hookFeeBps }) => countedTaxBps(roundTrip, hookFeeBps) > limits.maxTaxBps,
  ],
  [
    "low_liquidity",
    ({ answers, limits }) =>
      reportsOf(answers).length > 0 &&
      (liquidityOf(answers) ?? 0n) < limits.liquidityFloorUsdMicros,
  ],
  [
    "sources_down",
    ({ answers, roundTrip }) =>
      roundTrip.kind === "unavailable" ||
      answers.some((answer) => answer.isRequired && answer.outcome !== "reported"),
  ],
  [
    "blacklisted",
    ({ roundTrip }, flags) => flags.has("blacklist") || isRefused(roundTrip, "transfer"),
  ],
];

function sourceFlags(answers: readonly SourceAnswer[]): readonly RiskFlag[] {
  return answers.flatMap((answer) =>
    answer.outcome === "reported"
      ? answer.report.flags.map((code) => ({ code, source: answer.id }))
      : [{ code: answer.outcome === "down" ? "unavailable" : "not_covered", source: answer.id }],
  );
}

function roundTripFlags(roundTrip: RoundTrip): readonly RiskFlag[] {
  if (roundTrip.kind === "measured") {
    return roundTrip.transferTaxBps > 0 ? [{ code: "transfer_tax", source: simulationSource }] : [];
  }
  const code = roundTrip.kind === "unavailable" ? "unavailable" : refusedLegCodes[roundTrip.leg];
  return [{ code, source: simulationSource }];
}

// A refusal blocks; a passing token with any finding or tax is a warning.
function verdictOf(view: {
  readonly refusal: RiskReason | undefined;
  readonly flags: readonly RiskFlag[];
  readonly taxBps: number;
}): RiskView["verdict"] {
  if (view.refusal !== undefined) {
    return "block";
  }
  return view.flags.length > 0 || view.taxBps > 0 ? "warn" : "pass";
}

function viewOf(findings: RiskFindings, refusal: RiskReason | undefined): RiskView {
  const { answers, roundTrip } = findings;
  const flags = [...sourceFlags(answers), ...roundTripFlags(roundTrip)];
  const taxes =
    roundTrip.kind === "measured"
      ? { buyTaxBps: roundTrip.buyTaxBps, sellTaxBps: roundTrip.sellTaxBps }
      : {};
  const taxBps = highestTaxBps(roundTrip) ?? 0;
  const liquidity = liquidityOf(answers);
  const insiders = findings.insiders ?? [];
  return {
    verdict: verdictOf({ refusal, flags, taxBps }),
    flags,
    ...taxes,
    ...(liquidity === undefined ? {} : { liquidityUsdMicros: liquidity }),
    ...(insiders.length === 0 ? {} : { insiders }),
    onCurve: false,
    checkedAt: findings.checkedAtMs,
  };
}

/**
 * Weighs what the risk sources and the round trip found for a token the registry does not list
 * (ARCHITECTURE.md section 7, risk tiers). A hard finding blocks: a honeypot, a sale that fails, a
 * hidden owner who can change balances, a launch-window tax the quote names above the agent's
 * maximum tax, a measured tax above that maximum (a buy's with the fee its route's pool hooks
 * keep, counted once), liquidity below its floor, a required source or the round trip that could
 * not answer, or a blacklist. The reason stored is the first of spec 6's risk reasons that holds. A token that passes with any
 * finding or tax is a warning. The tax is the highest the round trip measured on any leg: the
 * sources' own tax figures never decide it. The view records the wallets the token's launchpad
 * favors as its insiders.
 */
export function riskVerdict(findings: RiskFindings): RiskAssessment {
  const flags = new Set(reportsOf(findings.answers).flatMap((report) => report.flags));
  const refusal = checks.find(([, check]) => check(findings, flags))?.[0];
  const view = viewOf(findings, refusal);
  return refusal === undefined ? { view } : { view, refusal };
}
