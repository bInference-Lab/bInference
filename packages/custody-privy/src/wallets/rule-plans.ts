import type { PrivyRequest } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { maxCeilingBytes } from "../ceiling/ceiling-size.js";
import { type PolicyRule, policyRuleJson } from "../ceiling/policy-rule.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import type { PolicyRuleRef } from "../privy/privy-wire.schema.js";
import { ruleTexts } from "./policy-rules.schema.js";

/** One rule of a policy as Privy holds it, and the body to write over it. */
export interface RulePlan {
  readonly ref: PolicyRuleRef;
  readonly body: PolicyRule;
}

/** Signs a request as the owner key, or refuses; a refusal changes nothing. */
export type OwnerAuthorize = (
  request: PrivyRequest,
  signal: AbortSignal,
) => Promise<Result<string, "refused">>;

function textOf(json: Parameters<typeof ruleTexts>[0][number]): string | undefined {
  return ruleTexts([json])?.[0];
}

/** Whether the rule holds what the plan writes already, by what decides the rule's effect. */
export function isWritten(plan: RulePlan): boolean {
  return textOf(plan.ref.json) === textOf(policyRuleJson(plan.body));
}

/** What changes in a policy: rules written over, rules added and rules taken out. */
export interface RuleEdits {
  readonly writes: readonly RulePlan[];
  readonly adds: readonly PolicyRule[];
  readonly removes: readonly PolicyRuleRef[];
}

/** A policy and the edits to make to it, planned before any is sent. */
export interface PlannedEdits {
  readonly policy: PrivyId;
  readonly edits: RuleEdits;
}

/**
 * Whether a policy still fits what Privy keeps once the edits are made: its rules as Privy holds
 * them, each written over, added or taken out, within {@link maxCeilingBytes} as JSON.
 */
export function editsFit(refs: readonly PolicyRuleRef[], edits: RuleEdits): boolean {
  const written = new Map(edits.writes.map((plan) => [plan.ref.id, plan.body]));
  const removed = new Set(edits.removes.map((ref) => ref.id));
  const kept = refs
    .filter((ref) => !removed.has(ref.id))
    .map((ref) => {
      const body = written.get(ref.id);
      return body === undefined ? ref.json : policyRuleJson(body);
    });
  const rules = [...kept, ...edits.adds.map(policyRuleJson)];
  return JSON.stringify(rules).length <= maxCeilingBytes;
}

/**
 * Edits a policy now, signed by the owner key, one request at a time: each rule written over
 * that does not hold its body yet, then each rule added, then each taken out, so the policy never
 * loses a rule before the ones that replace it are in. A refusal stops the rest. Each request
 * expires at `expiresAtMs`.
 */
export async function editRules(
  api: PrivyApi,
  target: { readonly policy: PrivyId; readonly edits: RuleEdits },
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, "not_found" | "refused">> {
  const { policy, edits } = target;
  const written = await writeRules(api, { policy, plans: edits.writes }, input);
  if (!written.ok) {
    return written;
  }
  const { authorize, expiresAtMs, signal } = input;
  const requests = [
    ...edits.adds.map(
      (body) => async () => api.addRule({ policy, body, expiresAtMs }, { authorize, signal }),
    ),
    ...edits.removes.map(
      (ref) => async () =>
        api.removeRule(
          { policy, rule: ref.id, expiresAtMs },
          { authorization: { kind: "sign", authorize }, signal },
        ),
    ),
  ];
  for (const request of requests) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time: a refusal stops the rest
    const done = await request();
    if (!done.ok) {
      return err(done.error === "expired" ? "refused" : done.error);
    }
  }
  return ok(undefined);
}

/**
 * Writes each plan's body over its rule now, signed by the owner key, one rule at a time; a rule
 * that holds its body already is left alone, so writing the same plans twice is safe. A refusal
 * stops the rest. Each change expires at `expiresAtMs`.
 */
async function writeRules(
  api: PrivyApi,
  target: { readonly policy: PrivyId; readonly plans: readonly RulePlan[] },
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, "not_found" | "refused">> {
  const { authorize, expiresAtMs, signal } = input;
  for (const plan of target.plans.filter((each) => !isWritten(each))) {
    const change = { policy: target.policy, rule: plan.ref.id, body: plan.body, expiresAtMs };
    const authorization = { kind: "sign", authorize } as const;
    // oxlint-disable-next-line eslint/no-await-in-loop -- one rule at a time: a refusal stops the rest
    const changed = await api.changeRule(change, { authorization, signal });
    if (!changed.ok) {
      return err(changed.error === "expired" ? "refused" : changed.error);
    }
  }
  return ok(undefined);
}
