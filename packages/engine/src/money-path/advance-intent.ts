import { BinferenceError } from "@binference/core";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import type { IntentStateMachine } from "../intents/state-machine.js";

/** What a step of the money path moves an intent through, and the signal of its run. */
export interface AdvanceParts {
  readonly stored: StoredIntents;
  readonly machine: IntentStateMachine;
  readonly signal: AbortSignal;
}

/**
 * Moves an intent the money path runs by one trigger, by the engine, with what the step produced,
 * and answers the intent after it. A trigger the state machine refuses is a fault: the money path
 * reports only outcomes its states take. A move that lost its version to another write, such as a
 * cancel, ends the run where that write left the intent.
 */
export async function advanceIntent(
  parts: AdvanceParts,
  snapshot: IntentSnapshot,
  move: { readonly trigger: IntentTrigger } & Pick<IntentMove, "fields">,
): Promise<IntentSnapshot> {
  const { stored, machine, signal } = parts;
  const step = machine.apply(snapshot.stored.status, move.trigger);
  if (!step.ok) {
    throw new BinferenceError({
      code: "engine.step_refused",
      message: `The state machine refused ${move.trigger.type} on intent ${snapshot.record.id}.`,
      details: { intent: snapshot.record.id, problem: step.error },
    });
  }
  const intent = snapshot.record.id;
  const write = { intent, version: snapshot.stored.version, step: step.value, by: "engine" };
  const moved = await stored.move({ ...write, ...move }, { signal });
  return moved.ok ? moved.value : ((await stored.snapshot(intent, { signal })) ?? snapshot);
}
