import { err, ok, type Result } from "@binference/core";
import { callRules } from "../ceiling/build-ceiling.js";
import type { CeilingChain, CeilingProblem } from "../ceiling/ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import { type PolicyRuleRef, readRuleRefs } from "../privy/privy-wire.schema.js";
import { editRules, type OwnerAuthorize, type RuleEdits } from "./rule-plans.js";

/** A ceiling, and what a contract call may do on each chain whose rules change. */
export interface PolicyCalls {
  readonly policy: PrivyId;
  readonly chains: readonly CeilingChain[];
}

/** Why a ceiling's contract calls cannot change. */
export type CallsRefusal =
  | CeilingProblem
  /** Privy holds no such policy, or it enables no such chain. */
  | "not_found"
  /** The owner key did not sign, or Privy did not take its signature as the policy owner's. */
  | "refused";

// The rules of a chain that name what a call may do: its call rules and its approval rule, and a
// launch wallet's launch call rules and approval of any spender (decision 0217).
function isCallsRule(name: string, chainId: string): boolean {
  const onChain = name.endsWith(`, chain ${chainId}`);
  const isCall = name.startsWith("Call ") || name.startsWith("Launch call ");
  const isApprovals = name === `Approvals, chain ${chainId}`;
  return onChain && (isCall || isApprovals || name === `Launch approvals, chain ${chainId}`);
}

// One chain's call and approval rules, rebuilt: written over, added or taken out by name. A chain
// the policy sends nothing on is one it never enabled.
function chainEdits(
  rules: readonly PolicyRuleRef[],
  chain: CeilingChain,
): Result<RuleEdits, CallsRefusal> {
  const chainId = String(chain.chain.chainId);
  const bodies = callRules(chain);
  if (!bodies.ok) {
    return bodies;
  }
  if (!rules.some((rule) => rule.name === `Native sends, chain ${chainId}`)) {
    return err("not_found");
  }
  const held = rules.filter((rule) => isCallsRule(rule.name, chainId));
  const named = (name: string) => held.find((rule) => rule.name === name);
  return ok({
    writes: bodies.value.flatMap((body) => {
      const ref = named(body.name);
      return ref === undefined ? [] : [{ ref, body }];
    }),
    adds: bodies.value.filter((body) => named(body.name) === undefined),
    removes: held.filter((rule) => !bodies.value.some((body) => body.name === rule.name)),
  });
}

function editsOf(
  rules: readonly PolicyRuleRef[],
  chains: readonly CeilingChain[],
): Result<RuleEdits, CallsRefusal> {
  const each: RuleEdits[] = [];
  for (const chain of chains) {
    const edits = chainEdits(rules, chain);
    if (!edits.ok) {
      return edits;
    }
    each.push(edits.value);
  }
  return ok({
    writes: each.flatMap((item) => item.writes),
    adds: each.flatMap((item) => item.adds),
    removes: each.flatMap((item) => item.removes),
  });
}

/**
 * Sets what a contract call may do under a ceiling now, signed by the owner key (decision 0149):
 * on each chain given, one rule per function its venues call, on their contracts, with the cap in
 * native coin and the chain's 24-hour caps, and the approval rule for their spenders; on a launch
 * wallet's chain, its launch rules too, and on any other chain none (decision 0217). A rule that
 * holds its body already is left alone, so setting the same calls twice is safe; a rule a new
 * function needs is added, and one no function needs any more is taken out, after the others. A
 * chain the policy does not enable is `not_found`. Each request expires at `expiresAtMs`.
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
  const edits = editsOf(rules, target.chains);
  return edits.ok ? editRules(api, { policy: target.policy, edits: edits.value }, input) : edits;
}
