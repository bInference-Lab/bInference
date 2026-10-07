import {
  type Amount,
  type AssetRef,
  type PriceSource,
  type QuotedTrade,
  type UsdPrice,
  withQuotePrice,
} from "@binference/chain";
import { BinferenceError, type Clock, type Err, mulDiv, type Ok, ok } from "@binference/core";
import type { PolicyRejection } from "../intents/intent-reason.js";
import {
  type PastOutflow,
  type PolicyFacts,
  type PolicyFigures,
  type PolicyInput,
  policyRefusals,
  type PolicySubject,
  sellsDeniedToken,
} from "./policy-rules.js";

/** The policy's answer when every rule passes. */
export interface PolicyPass {
  /** The figures the caps passed with; absent for a rescue, which no cap counts. */
  readonly figures?: PolicyFigures;
  /**
   * The intent moves a token on the deny list out of the wallet. It passes, but only the owner's
   * tap confirms it: pass this mark to the auto test (decision 0101).
   */
  readonly sellsDeniedToken: boolean;
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
   * `PriceSource` and rounded up, so a cap never rounds in the agent's favor. With the trade's own
   * `quote`, a token the source cannot price takes its price from the quote, valued at the other
   * side's price (decision 0059); without one, that token has no price.
   */
  check(
    subject: PolicySubject,
    facts: PolicyFacts,
    options: PolicyCheckCall,
  ): Promise<PolicyVerdict>;
}

/** What one policy check runs with besides the intent and its facts. */
interface PolicyCheckCall {
  readonly signal: AbortSignal;
  /** The trade's own quote, when the venue gave one: what it spends and what it expects back. */
  readonly quote?: QuotedTrade;
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

function verdictOf(input: PolicyInput): PolicyVerdict {
  const { figures } = input;
  const withFigures = figures === undefined ? {} : { figures };
  const [first, ...rest] = policyRefusals(input);
  return first === undefined
    ? ok({ ...withFigures, sellsDeniedToken: sellsDeniedToken(input) })
    : { ok: false, error: first, reasons: [first, ...rest], ...withFigures };
}

interface CheckCall extends PolicyCheckCall {
  readonly subject: PolicySubject;
  readonly facts: PolicyFacts;
}

async function checkIntent(
  { subject, facts, signal, quote }: CheckCall,
  options: PolicyCheckOptions,
): Promise<PolicyVerdict> {
  const nowMs = options.clock.now();
  if (subject.kind === "rescue") {
    return verdictOf({ subject, facts, nowMs });
  }
  const prices = quote === undefined ? options.prices : withQuotePrice(options.prices, quote);
  const valueUsdMicros = await valueOf(subject.outflows, prices, signal);
  const figures =
    valueUsdMicros === undefined
      ? undefined
      : {
          valueUsdMicros,
          rollingDaySpentUsdMicros: spentInWindow(facts.recentOutflows, nowMs),
        };
  return verdictOf({ subject, facts, nowMs, ...(figures === undefined ? {} : { figures }) });
}

/** Creates the {@link PolicyCheck}. */
export function createPolicyCheck(options: PolicyCheckOptions): PolicyCheck {
  return {
    check: async (subject, facts, call) => checkIntent({ subject, facts, ...call }, options),
  };
}
