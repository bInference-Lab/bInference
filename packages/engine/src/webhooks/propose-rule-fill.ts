import type { Ratio } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { assetsDocument } from "../intents/intent-documents.schema.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { FillProposal } from "../money-path/authorize-simulated.js";
import { checkOf, resizedSaleOf } from "../orders/fill-check.js";
import { proposalSkipOf } from "../orders/fill-ends.js";
import { type SizedFill, sizeFill } from "../orders/fill-request.js";
import { isUsablePrice } from "../positions/value-execution.js";
import type { AlertFillRecord } from "./alert-fill-record.js";
import type { AlertSkip } from "./end-alert.js";
import { ruleFillSubject, ruleFillTerms } from "./rule-fill-subject.js";
import type { WebhookFillParts } from "./webhook-fills.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** What proposing a rule's fill came to: a skip before any intent, or the intent as it ended. */
export type ProposedRuleFill =
  | { readonly kind: "skip"; readonly skip: Omit<AlertSkip, "event"> }
  | { readonly kind: "proposed"; readonly snapshot: IntentSnapshot };

// The decimals of the rule's token: the registry's, else what it answered for the rule's card.
async function decimalsOf(
  parts: Pick<WebhookFillParts, "chains" | "stored">,
  rule: WebhookRuleRecord,
  signal: AbortSignal,
): Promise<number | undefined> {
  const { token } = rule.request;
  const listed = assetInfoOf(parts.chains, token)?.decimals;
  if (listed !== undefined) {
    return listed;
  }
  const card = await parts.stored.snapshot(rule.intentId, { signal });
  const stored = card?.record.assets;
  return stored === undefined ? undefined : assetsDocument.decode(stored)[token]?.decimals;
}

// A sale sized in dollars counts them at the token's USD price now; any other fill needs none.
async function tokenUsdOf(
  parts: Pick<WebhookFillParts, "prices">,
  rule: WebhookRuleRecord,
  signal: AbortSignal,
): Promise<{ readonly tokenUsd?: Ratio }> {
  const { side, size, token } = rule.request;
  if (side !== "sell" || !("usdMicros" in size)) {
    return {};
  }
  const price = await parts.prices.usdPrice(token, { signal });
  return price.ok && isUsablePrice(price.value) ? { tokenUsd: price.value } : {};
}

// The fill's proposal: authorized by its rule and keyed on its alert's row (decision 0338), on
// paper, held in the agent's line to the rule as it stands.
function proposalOf(
  parts: WebhookFillParts,
  fill: {
    readonly rule: WebhookRuleRecord;
    readonly alert: AlertFillRecord;
    readonly sized: SizedFill;
    readonly decimals: number;
  },
): FillProposal {
  const { rule, alert, sized, decimals } = fill;
  const subject = ruleFillSubject({ rules: parts.rules, now: () => parts.clock.now() }, rule);
  const alertId = alert.alertId === undefined ? {} : { alertId: alert.alertId };
  return {
    authorization: { webhookRule: rule.id, event: alert.event, ...alertId },
    isPaper: rule.isPaper,
    decimals,
    check: checkOf(parts, { subject, sized, price: { decimals } }),
    termsHash: async () => Promise.resolve(undefined),
  };
}

const engineProposer = { role: "engine", ref: "engine", hasOutsideContent: false } as const;

/**
 * Proposes one alert's fill of its rule (decisions 0299 and 0338): sized from the rule's bounds
 * as an auto order's fill is, never from the alert's body, and run on the money path with no
 * card, its quote held to every bound at `simulated`. A sale in dollars whose first quote broke
 * its size is sized again at its own quote's price. A token nothing knows the decimals of skips as
 * `token_unreadable`, a size that comes to nothing as `nothing_to_spend` or `nothing_to_sell`, and
 * a proposal the money path refused before any intent with its route's reason.
 */
export async function proposeRuleFill(
  parts: WebhookFillParts,
  run: {
    readonly rule: WebhookRuleRecord;
    readonly alert: AlertFillRecord;
    readonly settings: AgentSettings;
    readonly signal: AbortSignal;
  },
): Promise<ProposedRuleFill> {
  const { rule, alert, settings, signal } = run;
  const decimals = await decimalsOf(parts, rule, signal);
  if (decimals === undefined) {
    return { kind: "skip", skip: { reason: "token_unreadable", tells: true } };
  }
  const terms = ruleFillTerms(rule);
  const priced = await tokenUsdOf(parts, rule, signal);
  const sized = await sizeFill(parts, { terms, settings, ...priced, signal });
  if (sized.kind !== "sized") {
    const reason = sized.kind === "empty" ? "nothing_to_sell" : sized.reason;
    return { kind: "skip", skip: { reason, tells: true } };
  }
  const propose = async (fill: SizedFill) =>
    parts.moneyPath.propose(fill.request, engineProposer, {
      signal,
      fill: proposalOf(parts, { rule, alert, sized: fill, decimals }),
    });
  const first = await propose(sized);
  const resized = first.ok
    ? await resizedSaleOf(parts, { terms, sized, snapshot: first.value, signal })
    : undefined;
  const proposed = resized === undefined ? first : await propose(resized);
  return proposed.ok
    ? { kind: "proposed", snapshot: proposed.value }
    : { kind: "skip", skip: { reason: proposalSkipOf(proposed.error), tells: true } };
}
