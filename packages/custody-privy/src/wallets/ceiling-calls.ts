import { err, ok, type Result } from "@binference/core";
import { bridgedOf, type CeilingAddresses } from "../ceiling/bridge-recipients.js";
import { callRules } from "../ceiling/build-ceiling.js";
import type { BridgedAddresses, CeilingChain, CeilingProblem } from "../ceiling/ceiling.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import { type PolicyRuleRef, readRuleRefs } from "../privy/privy-wire.schema.js";
import {
  editRules,
  editsFit,
  type OwnerAuthorize,
  type PlannedEdits,
  type RuleEdits,
} from "./rule-plans.js";

/**
 * A ceiling, what a contract call may do on each chain whose rules change, and the addresses a
 * bridge may pay on each destination; absent, the ones its bridge rules pay now.
 */
export interface PolicyCalls {
  readonly policy: PrivyId;
  readonly chains: readonly CeilingChain[];
  readonly bridged?: readonly BridgedAddresses[];
}

/** Why a ceiling's contract calls cannot change. */
export type CallsRefusal =
  | CeilingProblem
  /** Privy holds no such policy, or it enables no such chain. */
  | "not_found"
  /** The owner key did not sign, or Privy did not take its signature as the policy owner's. */
  | "refused";

// The rules of a chain that name what a call may do: its call rules, its bridge rules and its
// approval rule, and a launch wallet's launch call rules and approval of any spender (decisions
// 0217 and 0302).
function isCallsRule(name: string, chainId: string): boolean {
  const onChain = name.endsWith(`, chain ${chainId}`);
  const isCall = name.startsWith("Call ") || name.startsWith("Launch call ");
  const isApprovals = name === `Approvals, chain ${chainId}`;
  const isBridge = name.startsWith("Bridge ") && name.includes(`, chain ${chainId} to `);
  const isLaunchApprovals = name === `Launch approvals, chain ${chainId}`;
  return isBridge || (onChain && (isCall || isApprovals || isLaunchApprovals));
}

// One chain's call and approval rules, rebuilt: written over, added or taken out by name. A chain
// the policy sends nothing on is one it never enabled.
function chainEdits(
  rules: readonly PolicyRuleRef[],
  target: { readonly chain: CeilingChain; readonly addresses: CeilingAddresses },
): Result<RuleEdits, CallsRefusal> {
  const { chain, addresses } = target;
  const chainId = String(chain.chain.chainId);
  const bodies = callRules(chain, addresses);
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
  target: { readonly chains: readonly CeilingChain[]; readonly addresses: CeilingAddresses },
): Result<RuleEdits, CallsRefusal> {
  const each: RuleEdits[] = [];
  for (const chain of target.chains) {
    const edits = chainEdits(rules, { chain, addresses: target.addresses });
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
 * Plans what a contract call may do under a ceiling (decision 0149), sending nothing: on each
 * chain given, one rule per function its venues call, on their contracts, with the cap in native
 * coin and the chain's 24-hour caps, and the approval rule for their spenders; on a launch
 * wallet's chain, its launch rules too, and on any other chain none (decision 0217); and the
 * bridge rules, paying the addresses its bridge rules pay now unless others are given (decision
 * 0302). A rule that holds its body already is left alone; a rule a new function needs is added,
 * and one no function needs any more is taken out. A chain the policy does not enable is
 * `not_found`, and a policy past what Privy keeps once edited is `too_large`.
 */
export async function planCeilingCalls(
  api: PrivyApi,
  target: PolicyCalls,
  options: CallOptions,
): Promise<Result<PlannedEdits, CallsRefusal>> {
  const found = await api.policy(target.policy, options);
  const rules = found.ok ? readRuleRefs(found.value.rules) : undefined;
  const held = rules === undefined ? undefined : readCeiling(rules.map((rule) => rule.json));
  if (rules === undefined || held === undefined) {
    return err("not_found");
  }
  const addresses = {
    recipients: held.recipients,
    bridged: target.bridged ?? bridgedOf(held.bridges),
  };
  const edits = editsOf(rules, { chains: target.chains, addresses });
  if (!edits.ok) {
    return edits;
  }
  return editsFit(rules, edits.value)
    ? ok({ policy: target.policy, edits: edits.value })
    : err("too_large");
}

/**
 * Makes the edits {@link planCeilingCalls} or {@link planCeilingRecipients} planned, signed by the
 * owner key, one request at a time: rules written over, then added, then taken out, each request
 * expiring at `expiresAtMs`. Planning every ceiling of a change before writing any keeps a refusal
 * from leaving an agent's wallets under different ceilings.
 */
export async function writePlannedEdits(
  api: PrivyApi,
  planned: PlannedEdits,
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, "not_found" | "refused">> {
  return editRules(api, planned, input);
}

/**
 * Sets what a contract call may do under a ceiling now, signed by the owner key, as
 * {@link planCeilingCalls} plans it. A rule that holds its body already is left alone, so setting
 * the same calls twice is safe. Each request expires at `expiresAtMs`.
 */
export async function setCeilingCalls(
  api: PrivyApi,
  target: PolicyCalls,
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, CallsRefusal>> {
  const planned = await planCeilingCalls(api, target, input);
  return planned.ok ? writePlannedEdits(api, planned.value, input) : planned;
}
