import type { Id } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentState } from "../intents/intent-state.js";
import { cancelCard } from "../orders/cancel-order.js";
import { closeIntent, readCard } from "../orders/follow-order-card.js";
import type { WebhookRuleParts } from "./webhook-rule-parts.js";
import type { WebhookRuleMove, WebhookRuleRecord } from "./webhook-rule-record.js";

// The states of a card that is still on its way to the owner, or waits for the answer.
const waitingStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "awaiting_confirmation",
]);

// The card version the intent's confirmation names, once the owner confirmed it.
function confirmedCardOf(snapshot: IntentSnapshot): Id<"crd"> | undefined {
  const version = snapshot.stored.confirmation?.cardVersion;
  return snapshot.history.cards.find((card) => card.version === version)?.id;
}

/** What the card says of its waiting rule: active on its confirmed card, deleted, or nothing yet. */
type CardSays =
  | { readonly to: "active"; readonly cardId: Id<"crd"> }
  | { readonly to: "deleted"; readonly cancelsCard: boolean }
  | undefined;

// A frozen agent's waiting rule ends with its card; a rule the tap came after it expired ends too
// (decision 0299). An intent that is not stored, as a stop between the rule and its intent leaves,
// ends the rule.
function cardSays(
  rule: WebhookRuleRecord,
  snapshot: IntentSnapshot | undefined,
  nowMs: number,
): CardSays {
  const state = snapshot?.record.state;
  if (snapshot === undefined || state === undefined) {
    return { to: "deleted", cancelsCard: false };
  }
  if (snapshot.settings.agent.frozenAtMs !== undefined) {
    return { to: "deleted", cancelsCard: true };
  }
  if (waitingStates.has(state)) {
    return undefined;
  }
  const cardId = confirmedCardOf(snapshot);
  const isConfirmed = state === "confirmed" || state === "reconciled";
  return isConfirmed && cardId !== undefined && nowMs < rule.expiresAtMs
    ? { to: "active", cardId }
    : { to: "deleted", cancelsCard: false };
}

// Moves a waiting rule as its card says; a move another write beat leaves the rule to it, and a
// freeze that came between ends the rule with its card.
async function moveWaiting(
  parts: WebhookRuleParts,
  read: {
    readonly rule: WebhookRuleRecord;
    readonly snapshot: IntentSnapshot | undefined;
    readonly nowMs: number;
  },
  signal: AbortSignal,
): Promise<void> {
  const { rule, snapshot, nowMs } = read;
  const says = rule.state === "awaiting_confirmation" ? cardSays(rule, snapshot, nowMs) : undefined;
  if (says === undefined) {
    return;
  }
  const base = { id: rule.id, expectedVersion: rule.version, atMs: nowMs };
  const move: WebhookRuleMove =
    says.to === "active"
      ? { ...base, state: "active", cardId: says.cardId }
      : { ...base, state: "deleted" };
  const written = await parts.rules.move(move, { signal });
  if (!written.ok && written.error === "frozen") {
    await parts.rules.move({ ...base, state: "deleted" }, { signal });
    await cancelCard(parts, rule.intentId, signal);
    return;
  }
  if (written.ok && says.to === "deleted" && says.cancelsCard) {
    await cancelCard(parts, rule.intentId, signal);
  }
}

/**
 * Follows a webhook rule's card (decision 0299): on its Confirm the rule becomes `active`, unless
 * it expired meanwhile; on Cancel, a cancel of the intent, the card's timer or a freeze it ends as
 * `deleted`. A frozen agent's waiting rule ends with its card. The confirmed intent then moves to
 * `reconciled`. An answer runs it at once; the card timer runs it for every waiting rule, which
 * also finishes a tap a stop cut short. It answers the intent as it stands after.
 */
export async function followRuleCard(
  parts: WebhookRuleParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<IntentSnapshot | undefined> {
  // The time is read before the card: a tap the read misses came after it.
  const nowMs = parts.clock.now();
  const [rule, snapshot] = await Promise.all([
    parts.rules.byIntent(intent, { signal }),
    readCard(parts, intent, { nowMs, signal }),
  ]);
  if (rule !== undefined) {
    await moveWaiting(parts, { rule, snapshot, nowMs }, signal);
  }
  return closeIntent(parts, snapshot, signal);
}

/** Follows the card of each rule waiting for it, oldest first (`followRuleCard`). */
export async function followWaitingRules(
  parts: WebhookRuleParts,
  signal: AbortSignal,
): Promise<void> {
  const waiting = await parts.rules.list(
    { states: ["awaiting_confirmation"], limit: 1_000 },
    { signal },
  );
  // One at a time, oldest first: each reads its card, then writes its rule.
  await waiting.reduce<Promise<void>>(async (done, rule) => {
    await done;
    await followRuleCard(parts, rule.intentId, signal);
  }, Promise.resolve());
}
