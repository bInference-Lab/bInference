import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { type AddressProblem, addressList, recipientRules } from "../ceiling/build-ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import type { PolicyRuleRef } from "../privy/privy-wire.schema.js";
import { readRuleRefs } from "../privy/privy-wire.schema.js";
import { isWritten, type OwnerAuthorize, type RulePlan, writeRules } from "./rule-plans.js";

/** A ceiling, and every address its send rules let a send pay, on each chain it enables. */
export interface PolicyRecipients {
  readonly policy: PrivyId;
  readonly recipients: readonly string[];
}

/** Why a ceiling's recipients cannot change. */
export type RecipientsRefusal =
  | AddressProblem
  /** Privy holds no such policy, or the policy has no send rules to change. */
  | "not_found"
  /** The owner key did not sign, or Privy did not take its signature as the policy owner's. */
  | "refused";

/** A change of one send rule, signed ahead by the owner key over its exact request. */
export interface SignedRuleChange {
  readonly rule: PrivyId;
  readonly name: string;
  readonly signature: string;
}

/**
 * A change of a ceiling's recipients that the owner key signed ahead, to send later: from the
 * recipients its send rules list when it was signed, to new ones, until its expiry. It holds no
 * secret: a signature authorizes only this change, and only until it expires.
 */
export interface SignedRecipients {
  readonly policy: PrivyId;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly expiresAtMs: number;
  readonly changes: readonly SignedRuleChange[];
}

const privyIdSchema = z.string().refine(isPrivyId);

/** Parses a change signed ahead, as it is kept between its signing and its sending. */
export const signedRecipientsSchema: z.ZodType<SignedRecipients> = z.strictObject({
  policy: privyIdSchema,
  from: z.array(z.string()).max(100),
  to: z.array(z.string()).max(100),
  expiresAtMs: z.int().positive(),
  changes: z
    .array(z.strictObject({ rule: privyIdSchema, name: z.string(), signature: z.string() }))
    .max(64),
});

/** Why a change signed ahead was not sent. */
export type SignedRecipientsRefusal =
  /** A send rule no longer lists what it listed when the change was signed. */
  "changed" | "expired" | "refused" | "not_found";

const sendRuleName = /^(?:Native|Token) sends, chain (\d{1,10})$/;

// The send rules of a policy as Privy holds them now; a policy without one is `not_found`.
async function sendRulesOf(
  api: PrivyApi,
  policy: PrivyId,
  options: CallOptions,
): Promise<Result<readonly PolicyRuleRef[], "not_found">> {
  const found = await api.policy(policy, options);
  const refs = (found.ok ? readRuleRefs(found.value.rules) : undefined) ?? [];
  const sendRules = refs.filter((ref) => sendRuleName.test(ref.name));
  return sendRules.length === 0 ? err("not_found") : ok(sendRules);
}

// Each send rule, rebuilt to list the recipients.
function plansOf(
  rules: readonly PolicyRuleRef[],
  recipients: readonly string[],
): Result<readonly RulePlan[], AddressProblem> {
  const listed = addressList(recipients);
  if (!listed.ok) {
    return listed;
  }
  return ok(
    rules.flatMap((ref): RulePlan[] => {
      const chainId = sendRuleName.exec(ref.name)?.[1] ?? "";
      const body = recipientRules(chainId, listed.value).find((rule) => rule.name === ref.name);
      return body === undefined ? [] : [{ ref, body }];
    }),
  );
}

async function planOf(
  api: PrivyApi,
  target: PolicyRecipients,
  options: CallOptions,
): Promise<Result<readonly RulePlan[], RecipientsRefusal>> {
  const rules = await sendRulesOf(api, target.policy, options);
  return rules.ok ? plansOf(rules.value, target.recipients) : rules;
}

/**
 * Sets the recipients of a ceiling now, signed by the owner key: each send rule of each chain
 * lists exactly these addresses, checksummed. A rule that lists them already is left alone, so
 * setting the same recipients twice is safe. Each change expires at `expiresAtMs`.
 */
export async function setCeilingRecipients(
  api: PrivyApi,
  target: PolicyRecipients,
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, RecipientsRefusal>> {
  const plans = await planOf(api, target, input);
  return plans.ok ? writeRules(api, { policy: target.policy, plans: plans.value }, input) : plans;
}

/**
 * Signs now, with the owner key, a change of a ceiling's recipients from `from` to `to`, to send
 * later with {@link sendSignedRecipients} before `expiresAtMs`. It sends nothing.
 */
export async function signCeilingRecipients(
  api: PrivyApi,
  target: {
    readonly policy: PrivyId;
    readonly from: readonly string[];
    readonly to: readonly string[];
  },
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<SignedRecipients, RecipientsRefusal>> {
  const plans = await planOf(api, { policy: target.policy, recipients: target.to }, input);
  if (!plans.ok) {
    return plans;
  }
  const { expiresAtMs } = input;
  const changes: SignedRuleChange[] = [];
  for (const plan of plans.value) {
    const change = { policy: target.policy, rule: plan.ref.id, body: plan.body, expiresAtMs };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the owner signs one request at a time
    const signed = await input.authorize(api.ruleChangeRequest(change), input.signal);
    if (!signed.ok) {
      return signed;
    }
    changes.push({ rule: plan.ref.id, name: plan.ref.name, signature: signed.value });
  }
  const { policy, from, to } = target;
  return ok({ policy, from, to, expiresAtMs, changes });
}

/** One rule change signed ahead, with what it changes the rule to. */
interface SignedPlan {
  readonly change: SignedRuleChange;
  readonly next: RulePlan;
}

// Each change still to send, or `changed` when a rule lists neither what it listed when the change
// was signed nor what the change makes it list.
function stillToSend(
  signed: SignedRecipients,
  plans: { readonly from: readonly RulePlan[]; readonly to: readonly RulePlan[] },
): Result<readonly SignedPlan[], "changed"> {
  const toSend: SignedPlan[] = [];
  for (const change of signed.changes) {
    const next = plans.to.find((plan) => plan.ref.id === change.rule);
    const was = plans.from.find((plan) => plan.ref.id === change.rule);
    if (next === undefined || was === undefined || (!isWritten(next) && !isWritten(was))) {
      return err("changed");
    }
    if (!isWritten(next)) {
      toSend.push({ change, next });
    }
  }
  return ok(toSend);
}

/**
 * Sends a change the owner key signed ahead. Each send rule must still list the recipients it
 * listed when the change was signed, or the new ones already; otherwise nothing is sent and the
 * answer is `changed`, so a change signed earlier never undoes a later one.
 */
export async function sendSignedRecipients(
  api: PrivyApi,
  signed: SignedRecipients,
  options: CallOptions,
): Promise<Result<void, SignedRecipientsRefusal>> {
  const rules = await sendRulesOf(api, signed.policy, options);
  if (!rules.ok) {
    return rules;
  }
  const from = plansOf(rules.value, signed.from);
  const to = plansOf(rules.value, signed.to);
  const toSend =
    from.ok && to.ok ? stillToSend(signed, { from: from.value, to: to.value }) : err("changed");
  if (!toSend.ok) {
    return toSend;
  }
  for (const { change, next } of toSend.value) {
    const ruleChange = {
      policy: signed.policy,
      rule: change.rule,
      body: next.body,
      expiresAtMs: signed.expiresAtMs,
    };
    const authorization = { kind: "signed", signature: change.signature } as const;
    // oxlint-disable-next-line eslint/no-await-in-loop -- one rule at a time: a refusal stops the rest
    const sent = await api.changeRule(ruleChange, { ...options, authorization });
    if (!sent.ok) {
      return sent;
    }
  }
  return ok(undefined);
}
