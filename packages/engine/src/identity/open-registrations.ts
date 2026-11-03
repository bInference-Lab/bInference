import type { Id } from "@binference/core";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentState } from "../intents/intent-state.js";
import { statesBeforeSigning } from "../intents/transition-table.js";
import { liveIntentsIn } from "../money-path/live-intents.js";

/** The states of a registration whose step is signed and not yet settled. */
export const sentRegistrationStates: readonly IntentState[] = [
  "executing",
  "included",
  "finalized",
  "unknown_after_send",
];

/** The states of a registration that has not ended: before its signature, then on its way. */
export const openRegistrationStates: readonly IntentState[] = [
  ...statesBeforeSigning,
  ...sentRegistrationStates,
];

/**
 * Whether the agent has a live identity registration in one of `states` other than `except`, so
 * one registration per agent runs at a time (decision 0335).
 */
export async function hasRegistrationIn(
  stored: Pick<StoredIntents, "list">,
  asked: {
    readonly agent: Id<"agt">;
    readonly states: readonly IntentState[];
    readonly except?: Id<"int">;
  },
  signal: AbortSignal,
): Promise<boolean> {
  const query = { states: asked.states, agentId: asked.agent };
  const live = await liveIntentsIn(stored, query, signal);
  return live.some((record) => record.kind === "registerIdentity" && record.id !== asked.except);
}
