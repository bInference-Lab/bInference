import type { Amount, AssetRef } from "@binference/chain";
import { BinferenceError, type Clock, type Err, mulDiv, type Ok, ok } from "@binference/core";
import type { PolicyRejection } from "../intents/intent-reason.js";
import type { PriceSource, UsdPrice } from "../ports.js";
import {
  type PastOutflow,
  type PolicyFacts,
  type PolicyFigures,
  policyRefusals,
  type PolicySubject,
} from "./policy-rules.js";

/** The policy's answer when every rule passes. */
export interface PolicyPass {
  /** The figures the caps passed with; absent for a rescue, which no cap counts. */
  readonly figures?: PolicyFigures;
}

/**
 * The policy's answer when a rule fails. `error` is the reason the intent stores with
 * `rejected_policy`: the first of `reasons`, which lists every rule broken in spec 6's order.
 */
export interface PolicyRefused extends Err<PolicyRejection> {
  readonly reasons: readonly [PolicyRejection, ...PolicyRejection[]];
  /** The figures behind a cap refusal; absent when an outflow had no price, and for a rescue. */
  readonly figures?: PolicyFigures;
}

/** What the policy step decides about one intent. */
export type PolicyVerdict = Ok<PolicyPass> | PolicyRefused;

/**
 * The policy step of the money path (ARCHITECTURE.md section 7). It decides and never writes: the
 * caller reports the verdict to the state machine as `policy_passed` or `policy_refused`, and runs
 * it again as the wallet queue takes the intent.
 */
export interface PolicyCheck {
  /**
   * Checks a resolved intent against the owner's limits. Every outflow is priced through the
   * `PriceSource` and rounded up, so a cap never rounds in the agent's favor.
   */
  check(
    subject: PolicySubject,
    facts: PolicyFacts,
    options: { readonly signal: AbortSignal },
  ): Promise<PolicyVerdict>;
}

/** The ports the policy reads prices and the time from. */
export interface PolicyCheckOptions {
  readonly prices: PriceSource;
  readonly clock: Clock;
}

const rollingDayMs = 86_400_000;

// An outflow exactly 24 hours old still counts: the window never closes in the agent's favor.
function spentInWindow(outflows: readonly PastOutflow[], nowMs: number): bigint {
  return outflows
    .filter((outflow) => outflow.atMs >= nowMs - rollingDayMs)
    .reduce((sum, outflow) => {
      if (outflow.valueUsdMicros < 0n) {
        throw new BinferenceError({
          code: "policy.negative_outflow",
          message: "An earlier outflow must not have a negative USD value.",
        });
      }
      return sum + outflow.valueUsdMicros;
    }, 0n);
}

// A zero or malformed price would let any amount through the caps, so it counts as no price.
async function priceOf(
  asset: AssetRef,
  prices: PriceSource,
  signal: AbortSignal,
): Promise<UsdPrice | undefined> {
  const price = await prices.usdPrice(asset, { signal });
  return price.ok && price.value.numerator > 0n && price.value.denominator > 0n
    ? price.value
    : undefined;
}

async function valueOf(
  outflows: readonly Amount[],
  prices: PriceSource,
  signal: AbortSignal,
): Promise<bigint | undefined> {
  const assets = [...new Set(outflows.map((outflow) => outflow.asset))];
  const found = await Promise.all(assets.map(async (asset) => priceOf(asset, prices, signal)));
  const byAsset = new Map(assets.map((asset, index) => [asset, found[index]]));
  let totalUsdMicros = 0n;
  for (const outflow of outflows) {
    const price = byAsset.get(outflow.asset);
    if (price === undefined) {
      return undefined;
    }
    totalUsdMicros += mulDiv(outflow.base, price, "up");
  }
  return totalUsdMicros;
}

function verdictOf(
  reasons: readonly PolicyRejection[],
  figures: PolicyFigures | undefined,
): PolicyVerdict {
  const withFigures = figures === undefined ? {} : { figures };
  const [first, ...rest] = reasons;
  return first === undefined
    ? ok(withFigures)
    : { ok: false, error: first, reasons: [first, ...rest], ...withFigures };
}

interface CheckCall {
  readonly subject: PolicySubject;
  readonly facts: PolicyFacts;
  readonly signal: AbortSignal;
}

async function checkIntent(
  { subject, facts, signal }: CheckCall,
  options: PolicyCheckOptions,
): Promise<PolicyVerdict> {
  const nowMs = options.clock.now();
  if (subject.kind === "rescue") {
    return verdictOf(policyRefusals({ subject, facts, nowMs }), undefined);
  }
  const valueUsdMicros = await valueOf(subject.outflows, options.prices, signal);
  const figures =
    valueUsdMicros === undefined
      ? undefined
      : {
          valueUsdMicros,
          rollingDaySpentUsdMicros: spentInWindow(facts.recentOutflows, nowMs),
        };
  const input = { subject, facts, nowMs, ...(figures === undefined ? {} : { figures }) };
  return verdictOf(policyRefusals(input), figures);
}

/** Creates the {@link PolicyCheck}. */
export function createPolicyCheck(options: PolicyCheckOptions): PolicyCheck {
  return {
    check: async (subject, facts, { signal }) => checkIntent({ subject, facts, signal }, options),
  };
}
