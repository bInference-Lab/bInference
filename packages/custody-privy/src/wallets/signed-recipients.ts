import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { anyChain, maxListed } from "../ceiling/address-list.js";
import type { ChainAddresses } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import type { PolicyRuleRef } from "../privy/privy-wire.schema.js";
import {
  type RecipientsRefusal,
  recipientEditsOf,
  recipientRulesOf,
} from "./ceiling-recipients.js";
import { ruleTexts } from "./policy-rules.schema.js";
import { isWritten, type OwnerAuthorize, type RulePlan, type RuleEdits } from "./rule-plans.js";

/** A change of one rule, signed ahead by the owner key over its exact request. */
export interface SignedRuleChange {
  readonly rule: PrivyId;
  readonly name: string;
  readonly signature: string;
  /**
   * What decides the rule's effect after the change, as text; set for a bridge rule, whose new
   * body depends on what the policy held when the change was signed.
   */
  readonly text?: string;
}

/**
 * A change of a ceiling's recipients that the owner key signed ahead, to send later: from the
 * recipients it lists for each chain when it was signed, to new ones, until its expiry, with the
 * bridge rules it narrows and the ones it takes out (decision 0302). It holds no secret: a
 * signature authorizes only this change, and only until it expires.
 */
export interface SignedRecipients {
  readonly policy: PrivyId;
  readonly from: readonly ChainAddresses[];
  readonly to: readonly ChainAddresses[];
  readonly expiresAtMs: number;
  readonly changes: readonly SignedRuleChange[];
  /** The bridge rules the change takes out; absent in a change signed before bridges. */
  readonly removes?: readonly SignedRuleChange[];
}

const privyIdSchema = z.string().refine(isPrivyId);
const changeSchema = z.strictObject({
  rule: privyIdSchema,
  name: z.string(),
  signature: z.string(),
  text: z.string().exactOptional(),
});

// The recipients of a change: per chain, or, in a change signed before saved addresses named their
// chain, one list that stands for every chain.
const recipientsSchema: z.ZodType<readonly ChainAddresses[]> = z.union([
  z
    .array(z.strictObject({ chainId: z.string(), addresses: z.array(z.string()).max(maxListed) }))
    .max(maxListed),
  z
    .array(z.string())
    .max(maxListed)
    .transform((addresses) => [{ chainId: anyChain, addresses }]),
]);

/**
 * Parses a change signed ahead, as it is kept between its signing and its sending. A change signed
 * before saved addresses named their chain lists its recipients once, for every chain.
 */
export const signedRecipientsSchema: z.ZodType<SignedRecipients> = z.strictObject({
  policy: privyIdSchema,
  from: recipientsSchema,
  to: recipientsSchema,
  expiresAtMs: z.int().positive(),
  changes: z.array(changeSchema).max(256),
  removes: z.array(changeSchema).max(256).exactOptional(),
});

/** Why a change signed ahead was not sent. */
export type SignedRecipientsRefusal =
  /** A rule no longer holds what it held when the change was signed. */
  "changed" | "expired" | "refused" | "not_found";

const textOf = (plan: RulePlan): string | undefined => ruleTexts([policyRuleJson(plan.body)])?.[0];

/**
 * Signs now, with the owner key, a change of a ceiling's recipients from `from` to `to`, to send
 * later with {@link sendSignedRecipients} before `expiresAtMs`: each send rule's change, and each
 * bridge rule's change or removal as the policy holds it now. It sends nothing.
 */
export async function signCeilingRecipients(
  api: PrivyApi,
  target: {
    readonly policy: PrivyId;
    readonly from: readonly ChainAddresses[];
    readonly to: readonly ChainAddresses[];
  },
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<SignedRecipients, RecipientsRefusal>> {
  const refs = await recipientRulesOf(api, target.policy, input);
  const edits = refs.ok ? recipientEditsOf(refs.value, { recipients: target.to }) : refs;
  if (!edits.ok) {
    return edits;
  }
  if (edits.value.adds.length > 0) {
    return err("not_found");
  }
  const { policy, from, to } = target;
  const { expiresAtMs } = input;
  const changes: SignedRuleChange[] = [];
  const removes: SignedRuleChange[] = [];
  for (const plan of edits.value.writes) {
    const change = { policy, rule: plan.ref.id, body: plan.body, expiresAtMs };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the owner signs one request at a time
    const signed = await input.authorize(api.ruleChangeRequest(change), input.signal);
    if (!signed.ok) {
      return signed;
    }
    const text = isBridge(plan.ref.name) ? textOf(plan) : undefined;
    const made = { rule: plan.ref.id, name: plan.ref.name, signature: signed.value };
    changes.push(text === undefined ? made : { ...made, text });
  }
  for (const ref of edits.value.removes) {
    const removal = api.ruleRemovalRequest({ policy, rule: ref.id, expiresAtMs });
    // oxlint-disable-next-line eslint/no-await-in-loop -- the owner signs one request at a time
    const signed = await input.authorize(removal, input.signal);
    if (!signed.ok) {
      return signed;
    }
    removes.push({ rule: ref.id, name: ref.name, signature: signed.value });
  }
  return ok({ policy, from, to, expiresAtMs, changes, removes });
}

/** One rule change signed ahead, with what it changes the rule to. */
interface SignedPlan {
  readonly change: SignedRuleChange;
  readonly next: RulePlan;
}

// A send rule's change still to send, or `changed` when the rule lists neither what it listed
// when the change was signed nor what the change makes it list.
function sendStillToSend(
  change: SignedRuleChange,
  plans: { readonly from: RuleEdits; readonly to: RuleEdits },
): Result<SignedPlan | undefined, "changed"> {
  const next = plans.to.writes.find((plan) => plan.ref.id === change.rule);
  const was = plans.from.writes.find((plan) => plan.ref.id === change.rule);
  if (next === undefined || was === undefined || (!isWritten(next) && !isWritten(was))) {
    return err("changed");
  }
  return ok(isWritten(next) ? undefined : { change, next });
}

/** What a change signed ahead still sends: rule changes, then rule removals. */
interface StillToSend {
  readonly changes: readonly SignedPlan[];
  readonly removes: readonly SignedRuleChange[];
}

const isBridge = (name: string): boolean => name.startsWith("Bridge ");

// The bridge rules' changes and removals still to send: a rule whose needed body is the one signed
// for it, or holds it already, and a rule to take out that was signed out; anything else, or a rule
// to add, is `changed`.
function bridgesStillToSend(
  signed: SignedRecipients,
  needed: RuleEdits,
): Result<StillToSend, "changed"> {
  const changes: SignedPlan[] = [];
  for (const next of needed.writes.filter((plan) => isBridge(plan.ref.name) && !isWritten(plan))) {
    const change = signed.changes.find((item) => item.rule === next.ref.id);
    if (change?.text === undefined || change.text !== textOf(next)) {
      return err("changed");
    }
    changes.push({ change, next });
  }
  const removes = needed.removes.map((ref) => signed.removes?.find((item) => item.rule === ref.id));
  const found = removes.flatMap((item) => (item === undefined ? [] : [item]));
  const complete = found.length === removes.length && needed.adds.length === 0;
  return complete ? ok({ changes, removes: found }) : err("changed");
}

// Every edit the policy needs now, each signed ahead: a send rule as `sendStillToSend` reads it,
// a bridge rule as `bridgesStillToSend` does. Anything else is `changed`, so a change signed
// earlier never undoes a later one, and no address stays payable through a rule the change did not
// cover.
function stillToSend(
  signed: SignedRecipients,
  plans: { readonly from: RuleEdits; readonly to: RuleEdits },
): Result<StillToSend, "changed"> {
  const changes: SignedPlan[] = [];
  for (const change of signed.changes.filter((item) => !isBridge(item.name))) {
    const plan = sendStillToSend(change, plans);
    if (!plan.ok) {
      return plan;
    }
    changes.push(...(plan.value === undefined ? [] : [plan.value]));
  }
  const bridges = bridgesStillToSend(signed, plans.to);
  return bridges.ok
    ? ok({ changes: [...changes, ...bridges.value.changes], removes: bridges.value.removes })
    : bridges;
}

async function send(
  api: PrivyApi,
  target: { readonly signed: SignedRecipients; readonly toSend: StillToSend },
  options: CallOptions,
): Promise<Result<void, SignedRecipientsRefusal>> {
  const { policy, expiresAtMs } = target.signed;
  const requests = [
    ...target.toSend.changes.map(({ change, next }) => async () => {
      const ruleChange = { policy, rule: change.rule, body: next.body, expiresAtMs };
      const authorization = { kind: "signed", signature: change.signature } as const;
      return api.changeRule(ruleChange, { ...options, authorization });
    }),
    ...target.toSend.removes.map((removal) => async () => {
      const authorization = { kind: "signed", signature: removal.signature } as const;
      return api.removeRule(
        { policy, rule: removal.rule, expiresAtMs },
        { ...options, authorization },
      );
    }),
  ];
  for (const request of requests) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one rule at a time: a refusal stops the rest
    const sent = await request();
    if (!sent.ok) {
      return sent;
    }
  }
  return ok(undefined);
}

/**
 * Sends a change the owner key signed ahead. Each send rule must still list the recipients it
 * listed when the change was signed, or the new ones already, and each bridge rule must need
 * exactly the change or removal signed for it; otherwise nothing is sent and the answer is
 * `changed`, so a change signed earlier never undoes a later one. Changes go first, removals last.
 */
export async function sendSignedRecipients(
  api: PrivyApi,
  signed: SignedRecipients,
  options: CallOptions,
): Promise<Result<void, SignedRecipientsRefusal>> {
  const rules = await recipientRulesOf(api, signed.policy, options);
  if (!rules.ok) {
    return rules;
  }
  const refs: readonly PolicyRuleRef[] = rules.value;
  const from = recipientEditsOf(refs, { recipients: signed.from });
  const to = recipientEditsOf(refs, { recipients: signed.to });
  const toSend =
    from.ok && to.ok ? stillToSend(signed, { from: from.value, to: to.value }) : err("changed");
  return toSend.ok ? send(api, { signed, toSend: toSend.value }, options) : toSend;
}
