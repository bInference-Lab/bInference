import type { Id } from "@binference/core";
import { stableJson } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentStore } from "../ports.js";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** What binds a fill to its rule: the rule, its confirmed card's terms, its fills before, the alert. */
export interface RuleFillBinding {
  readonly rule: Id<"whr">;
  readonly ruleTermsHash: string;
  readonly fillsBefore: number;
  /** The alert's `webhook_events` row, which keys the fill (decision 0338). */
  readonly event: number;
}

/**
 * The terms hash of a webhook rule's fill (decision 0342): the SHA-256 of a tagged, versioned
 * document of the intent's id, its rule with the terms hash of the rule's confirmed card, the fills
 * the rule had before the fill and the alert's row, the request, the quote and the plan. It is
 * stored with the fill's authorization as the fill is confirmed, and the wallet queue signs only
 * while the fill as it reads it hashes to it again.
 */
export function ruleFillTermsHash(
  record: Pick<IntentRecord, "id" | "request" | "quote" | "plan">,
  binding: RuleFillBinding,
): Sha256Hex {
  const terms = {
    v: 1,
    kind: "ruleFill",
    intent: record.id,
    webhookRule: binding.rule,
    ruleTermsHash: binding.ruleTermsHash,
    fillsBefore: binding.fillsBefore,
    event: binding.event,
    request: record.request,
    quote: record.quote ?? null,
    plan: record.plan ?? null,
  };
  return sha256Hex(stableJson(terms));
}

/**
 * The terms hash of a rule's fill as its money path proposed it, bound to the rule's confirmed
 * card, the fills the rule had when the fill was sized and the alert's row; none when the rule's
 * card holds no confirmation.
 */
export async function proposedRuleTermsHash(
  intents: Pick<IntentStore, "confirmation">,
  call: {
    readonly rule: WebhookRuleRecord;
    readonly event: number;
    readonly simulated: IntentSnapshot;
    readonly signal: AbortSignal;
  },
): Promise<string | undefined> {
  const { rule, event, simulated, signal } = call;
  const card = await intents.confirmation(rule.intentId, { signal });
  if (card === undefined) {
    return undefined;
  }
  const binding = { rule: rule.id, ruleTermsHash: card.termsHash, fillsBefore: rule.fills, event };
  return ruleFillTermsHash(simulated.record, binding);
}
