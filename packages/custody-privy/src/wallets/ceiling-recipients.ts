import { err, ok, type Result } from "@binference/core";
import { type AddressProblem, addressList } from "../ceiling/address-list.js";
import { recipientRules } from "../ceiling/build-ceiling.js";
import type { BridgedAddresses } from "../ceiling/ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import type { PolicyRuleRef } from "../privy/privy-wire.schema.js";
import { readRuleRefs } from "../privy/privy-wire.schema.js";
import { bridgeRecipientEdits } from "./bridge-recipient-edits.js";
import {
  editRules,
  editsFit,
  type OwnerAuthorize,
  type PlannedEdits,
  type RulePlan,
  type RuleEdits,
} from "./rule-plans.js";

/**
 * A ceiling, every address its send rules let a send pay on each chain it enables, and the
 * addresses a bridge may pay on each destination; absent, the ones its bridge rules pay now.
 */
export interface PolicyRecipients {
  readonly policy: PrivyId;
  readonly recipients: readonly string[];
  readonly bridged?: readonly BridgedAddresses[];
}

/** Why a ceiling's recipients cannot change. */
export type RecipientsRefusal =
  | AddressProblem
  /**
   * Privy holds no such policy, the policy has no send rules to change, or its bridge rules cannot
   * be read.
   */
  | "not_found"
  /** The owner key did not sign, or Privy did not take its signature as the policy owner's. */
  | "refused"
  /** The policy, once edited, would be past what Privy keeps. */
  | "too_large";

const sendRuleName = /^(?:Native|Token) sends, chain (\d{1,10})$/;

/**
 * The rules of a policy as Privy holds them now; a policy without a send rule is `not_found`.
 */
export async function recipientRulesOf(
  api: PrivyApi,
  policy: PrivyId,
  options: CallOptions,
): Promise<Result<readonly PolicyRuleRef[], "not_found">> {
  const found = await api.policy(policy, options);
  const refs = (found.ok ? readRuleRefs(found.value.rules) : undefined) ?? [];
  return refs.some((ref) => sendRuleName.test(ref.name)) ? ok(refs) : err("not_found");
}

// Each send rule, rebuilt to list the recipients.
function sendPlansOf(
  refs: readonly PolicyRuleRef[],
  recipients: readonly string[],
): readonly RulePlan[] {
  return refs.flatMap((ref): RulePlan[] => {
    const chainId = sendRuleName.exec(ref.name)?.[1];
    const body =
      chainId === undefined
        ? undefined
        : recipientRules(chainId, recipients).find((rule) => rule.name === ref.name);
    return body === undefined ? [] : [{ ref, body }];
  });
}

/**
 * What a change of a ceiling's recipients edits (decision 0302): each send rule rebuilt to list
 * exactly the recipients, checksummed, and each bridge rule rebuilt to pay only the addresses still
 * among them, a destination left with none taken out. Removing a saved address, or replacing the
 * rescue address, so takes it out of every destination in the same change. A policy past what
 * Privy keeps once edited is `too_large`.
 */
export function recipientEditsOf(
  refs: readonly PolicyRuleRef[],
  target: Omit<PolicyRecipients, "policy">,
): Result<RuleEdits, RecipientsRefusal> {
  const listed = addressList(target.recipients);
  if (!listed.ok) {
    return listed;
  }
  const bridges = bridgeRecipientEdits(refs, {
    recipients: listed.value,
    ...(target.bridged === undefined ? {} : { bridged: target.bridged }),
  });
  if (!bridges.ok) {
    return bridges;
  }
  const { writes, adds, removes } = bridges.value;
  const edits = { writes: [...sendPlansOf(refs, listed.value), ...writes], adds, removes };
  return editsFit(refs, edits) ? ok(edits) : err("too_large");
}

/**
 * Plans a change of a ceiling's recipients as {@link recipientEditsOf} works it out, sending
 * nothing, so every ceiling of a change is planned before any is written.
 */
export async function planCeilingRecipients(
  api: PrivyApi,
  target: PolicyRecipients,
  options: CallOptions,
): Promise<Result<PlannedEdits, RecipientsRefusal>> {
  const refs = await recipientRulesOf(api, target.policy, options);
  const edits = refs.ok ? recipientEditsOf(refs.value, target) : refs;
  return edits.ok ? ok({ policy: target.policy, edits: edits.value }) : edits;
}

/**
 * Sets the recipients of a ceiling now, signed by the owner key: each send rule of each chain
 * lists exactly these addresses, checksummed, and each bridge rule pays only the addresses still
 * among them. A rule that holds its body already is left alone, so setting the same recipients
 * twice is safe. Each change expires at `expiresAtMs`.
 */
export async function setCeilingRecipients(
  api: PrivyApi,
  target: PolicyRecipients,
  input: CallOptions & { readonly authorize: OwnerAuthorize; readonly expiresAtMs: number },
): Promise<Result<void, RecipientsRefusal>> {
  const planned = await planCeilingRecipients(api, target, input);
  return planned.ok ? editRules(api, planned.value, input) : planned;
}
