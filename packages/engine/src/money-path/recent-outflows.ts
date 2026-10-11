import type { Id } from "@binference/core";
import type { ConfirmedIntent } from "../intents/confirmed-intent.js";
import type { IntentState } from "../intents/intent-state.js";
import type { PastOutflow } from "../policy/policy-rules.js";
import type { IntentStore } from "../ports.js";

/** Whose outflows to read: one agent's in one mode, up to now, without the intent under check. */
export interface RecentOutflowsQuery {
  readonly agentId: Id<"agt">;
  readonly isPaper: boolean;
  readonly nowMs: number;
  /** The intent under check, whose own confirmation is left out. */
  readonly exclude?: Id<"int">;
}

// The policy keeps 24 hours; an outflow exactly that old still counts, so the read keeps it too.
const windowMs = 86_400_000;
// The ends of a confirmed intent that moved nothing: nothing was signed or sent, or it reverted.
const movedNothing: ReadonlySet<IntentState> = new Set(["cancelled", "expired", "failed_onchain"]);

/**
 * Whether the rolling 24-hour cap counts a confirmed intent (decision 0136): one the policy
 * valued, unless it ended without moving anything and no dropped step of it landed late.
 */
export function isCounted(
  intent: ConfirmedIntent,
): intent is ConfirmedIntent & { readonly valueUsdMicros: bigint } {
  return (
    intent.valueUsdMicros !== undefined &&
    (!movedNothing.has(intent.state) || intent.landedLateAtMs !== undefined)
  );
}

/**
 * The outflows the rolling 24-hour cap counts for an agent (decision 0136): every intent of the
 * agent in the query's mode confirmed in the last 24 hours, by the owner's tap or the auto mode,
 * each counted from its confirmation at the USD value the policy judged it at, settled or not.
 * An intent that ended without moving anything (`cancelled`, `expired`, `failed_onchain`), one the
 * policy never valued, such as a rescue, and the intent under check do not count; one whose
 * dropped step landed after all counts again (decision 0147).
 */
export async function recentOutflowsOf(
  intents: Pick<IntentStore, "confirmedSince">,
  query: RecentOutflowsQuery,
  options: { readonly signal: AbortSignal },
): Promise<readonly PastOutflow[]> {
  const { agentId, isPaper, nowMs } = query;
  const confirmed = await intents.confirmedSince(
    { agentId, isPaper, fromMs: nowMs - windowMs },
    options,
  );
  return confirmed.flatMap((intent) =>
    isCounted(intent) && intent.intentId !== query.exclude
      ? [{ atMs: intent.confirmedAtMs, valueUsdMicros: intent.valueUsdMicros }]
      : [],
  );
}
