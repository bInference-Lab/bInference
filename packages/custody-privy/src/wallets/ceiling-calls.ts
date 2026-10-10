import { err, ok, type Result } from "@binference/core";
import { callRules } from "../ceiling/build-ceiling.js";
import type { CeilingChain, CeilingProblem } from "../ceiling/ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import { type PolicyRuleRef, readRuleRefs } from "../privy/privy-wire.schema.js";
import { type OwnerAuthorize, type RulePlan, writeRules } from "./rule-plans.js";

/** A ceiling, and what a contract call may do on each chain whose rules change. */
export interface PolicyCalls {
  readonly policy: PrivyId;
  readonly chains: readonly CeilingChain[];
}

/** Why a ceiling's contract calls cannot change. */
export type CallsRefusal =
  | CeilingProblem
  /** Privy holds no such policy, or it lacks a rule to change. */
  | "not_found"
  /** The owner key did not sign, or Privy did not take its signature as the policy owner's. */
  | "refused";

// Each contract-call and approval rule of each chain, rebuilt; a rule the policy lacks fails.
function plansOf(
  rules: readonly PolicyRuleRef[],
  chains: readonly CeilingChain[],
): Result<readonly RulePlan[], CallsRefusal> {
  const plans: RulePlan[] = [];
  for (const chain of chains) {
    const bodies = callRules(chain);
    if (!bodies.ok) {
      return bodies;
    }
    for (const body of bodies.value) {
      const ref = rules.find((rule) => rule.name === body.name);
      if (ref === undefined) {
        return err("not_found");
      }
      plans.push({ ref, body });
    }
  }
  return ok(plans);
}

/**
 * Sets what a contract call may do under a ceiling now, signed by the owner key: on each chain
 * given, the contract-call rule lists exactly the chain's contracts with its cap in native coin,
 * and the approval rule its spenders. A rule that holds that already is left alone, so setting the
 * same calls twice is safe. A rule the policy lacks, such as one for a chain it never listed a
 * contract on, is `not_found`, since a ceiling's rules are only ever written over. Each change
 * expires at `expiresAtMs`.
 */
export async function setCeilingCalls(
  api: PrivyApi,
  target: PolicyCalls,
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, CallsRefusal>> {
  const found = await api.policy(target.policy, input);
  const rules = found.ok ? readRuleRefs(found.value.rules) : undefined;
  if (rules === undefined) {
    return err("not_found");
  }
  const plans = plansOf(rules, target.chains);
  return plans.ok ? writeRules(api, { policy: target.policy, plans: plans.value }, input) : plans;
}
