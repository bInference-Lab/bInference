import type { FillSourceNow } from "@binference/chain";
import type { WebhookRuleAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { WebhookRuleStore } from "../webhooks/ports.js";
import { ruleFillTermsHash } from "../webhooks/rule-fill-terms-hash.js";
import type { WebhookRuleRecord } from "../webhooks/webhook-rule-record.js";

/** What a rule fill's terms read: its rule, the rule's card, and whether its agent is frozen. */
export interface RuleFillTermsParts {
  readonly rules: Pick<WebhookRuleStore, "get">;
  readonly agents: Pick<AgentStore, "get">;
  readonly intents: Pick<IntentStore, "confirmation">;
}

/** What binds a live fill to its order or rule, as its grant names them. */
export interface SourceBinding {
  readonly current: FillSourceNow;
  readonly sourceTermsHash: string;
  readonly fillsBefore: number;
  /** The fill's terms hash, as its confirmation stored it and its record hashes again. */
  readonly termsHash: string;
}

/**
 * The rule as the signer reads it for a fill of `event` (decision 0342): `active` only while it is
 * active and the alert came to its current URL, `url_rotated` once a rotation took that URL, and
 * `paused` while its agent is frozen, so a freeze lets only a sale under way finish.
 */
async function ruleNowOf(
  parts: RuleFillTermsParts,
  call: {
    readonly rule: WebhookRuleRecord;
    readonly ruleTermsHash: string;
    readonly event: number;
    readonly signal: AbortSignal;
  },
): Promise<FillSourceNow> {
  const { rule, event, signal } = call;
  const settings = await parts.agents.get(rule.agentId, { signal });
  const isFrozen = settings?.agent.frozenAtMs !== undefined;
  const isOwnUrl = event > rule.oldUrlLastEvent;
  const active = isFrozen ? "paused" : "active";
  const inUse = isOwnUrl ? active : "url_rotated";
  return {
    id: rule.id,
    state: rule.state === "active" ? inUse : rule.state,
    termsHash: call.ruleTermsHash,
    expiresAtMs: rule.expiresAtMs,
    fills: rule.fills,
    ...(rule.maxFills === undefined ? {} : { maxFills: rule.maxFills }),
  };
}

/**
 * The rule now of a rule fill's grant, read again right before one more signature, with its
 * confirmed card's terms hash. `undefined` once the rule or its card is gone.
 */
export async function ruleNowFor(
  parts: RuleFillTermsParts,
  fill: Pick<WebhookRuleAuthorization, "webhookRule" | "event">,
  signal: AbortSignal,
): Promise<FillSourceNow | undefined> {
  const rule = await parts.rules.get(fill.webhookRule, { signal });
  const card =
    rule === undefined ? undefined : await parts.intents.confirmation(rule.intentId, { signal });
  return rule === undefined || card === undefined
    ? undefined
    : ruleNowOf(parts, { rule, ruleTermsHash: card.termsHash, event: fill.event, signal });
}

/**
 * What binds a confirmed live rule fill to its rule (decision 0342): the rule now, its card's terms
 * hash and the fills before the fill, while the fill as it reads hashes to the terms its
 * confirmation stored; `undefined` otherwise, or once the rule or its card is gone.
 */
export async function ruleBindingOf(
  parts: RuleFillTermsParts,
  call: {
    readonly snapshot: IntentSnapshot;
    readonly fill: WebhookRuleAuthorization;
    readonly signal: AbortSignal;
  },
): Promise<SourceBinding | undefined> {
  const { snapshot, fill, signal } = call;
  const { fillsBefore } = fill;
  const current = await ruleNowFor(parts, fill, signal);
  if (current === undefined || fillsBefore === undefined) {
    return undefined;
  }
  const sourceTermsHash = current.termsHash;
  const binding = { rule: fill.webhookRule, ruleTermsHash: sourceTermsHash, fillsBefore };
  const termsHash = ruleFillTermsHash(snapshot.record, { ...binding, event: fill.event });
  return termsHash === fill.termsHash
    ? { current, sourceTermsHash, fillsBefore, termsHash }
    : undefined;
}
