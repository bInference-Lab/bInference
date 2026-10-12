import type { IntentKind } from "../intents/intent-kind.js";
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
// Rescues and unfreezes are rare, so a page this long reaches past them to any earlier live intent.
const pageSize = 50;
// The intents that trade nothing as they run: the rescue, the unfreeze and an auto order's card,
// whose fills come later, each its own trade. None counts as going live.
const ownerKinds: ReadonlySet<IntentKind> = new Set<IntentKind>([
  "rescue",
  "unfreeze",
  "autoOrder",
]);

type Proposed = Pick<IntentRecord, "id" | "agentId" | "kind" | "isPaper" | "createdAtMs">;

// Proposed after `intent`: later, or at the same time with a later id.
const isLater = (other: Proposed, intent: Proposed): boolean =>
  other.createdAtMs > intent.createdAtMs ||
  (other.createdAtMs === intent.createdAtMs && other.id > intent.id);

/**
 * Whether an intent's card is the agent's first live card, which says so with the
 * `card.warn.firstLive` line (ARCHITECTURE.md section 10): a live intent, not a rescue or an
 * unfreeze, while no live intent the agent proposed before it reached its card step, so a later
 * intent never takes the note away. A rescue moves the real funds in paper mode too (decision
 * 0100), and an unfreeze trades nothing (decision 0128), so neither counts as going live.
 */
export async function isFirstLiveCard(
  intents: IntentStore,
  intent: Proposed,
  options: { readonly signal: AbortSignal },
): Promise<boolean> {
  if (intent.isPaper || ownerKinds.has(intent.kind)) {
    return false;
  }
  const query = { states: reachedCard, agentId: intent.agentId, isPaper: false, limit: pageSize };
  const live = await intents.list(query, options);
  return live.every(
    (other) => other.id === intent.id || ownerKinds.has(other.kind) || isLater(other, intent),
  );
}
