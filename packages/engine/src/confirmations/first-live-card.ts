import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import type { IntentStore } from "../ports.js";

// The card step and every state after it: an intent in one of them reached its card, or the auto
// mode confirmed it, so the owner has seen it go live.
const reachedCard: readonly IntentState[] = [
  "awaiting_confirmation",
  "confirmed",
  "executing",
  "included",
  "finalized",
  "reconciled",
  "unknown_after_send",
  "failed_onchain",
  "denied",
  "expired",
  "cancelled",
];
// Rescues are rare, so a page this long reaches past them to any earlier live intent.
const pageSize = 50;

type Proposed = Pick<IntentRecord, "id" | "agentId" | "kind" | "isPaper" | "createdAtMs">;

// Proposed after `intent`: later, or at the same time with a later id.
const isLater = (other: Proposed, intent: Proposed): boolean =>
  other.createdAtMs > intent.createdAtMs ||
  (other.createdAtMs === intent.createdAtMs && other.id > intent.id);

/**
 * Whether an intent's card is the agent's first live card, which says so with the
 * `card.warn.firstLive` line (ARCHITECTURE.md section 10): a live intent, not a rescue, while no
 * live intent the agent proposed before it reached its card step, so a later intent never takes
 * the note away. A rescue moves the real funds in paper mode too (decision 0100), so it never
 * counts as going live.
 */
export async function isFirstLiveCard(
  intents: IntentStore,
  intent: Proposed,
  options: { readonly signal: AbortSignal },
): Promise<boolean> {
  if (intent.isPaper || intent.kind === "rescue") {
    return false;
  }
  const query = { states: reachedCard, agentId: intent.agentId, isPaper: false, limit: pageSize };
  const live = await intents.list(query, options);
  return live.every(
    (other) => other.id === intent.id || other.kind === "rescue" || isLater(other, intent),
  );
}
