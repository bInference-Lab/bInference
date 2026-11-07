import { BinferenceError, type Clock } from "@binference/core";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { IntentStore } from "../ports.js";
import type { ConfigChanges } from "./config-change-parts.js";
import { configChangeQuoteDocument, configChangeRequestDocument } from "./config-change-quote.js";

/** What a confirmed config change is applied and moved through. */
export interface ConfigChangeWriteParts {
  readonly stored: StoredIntents;
  readonly intents: IntentStore;
  readonly configChanges: ConfigChanges;
  readonly clock: Clock;
}

function quoteOf(snapshot: IntentSnapshot) {
  const { quote, id } = snapshot.record;
  if (quote === undefined) {
    throw new BinferenceError({
      code: "engine.no_quote",
      message: `Confirmed config change ${id} has no quote.`,
      details: { intent: id },
    });
  }
  return configChangeQuoteDocument.decode(quote);
}

/**
 * Applies a confirmed config change (decision 0393) and moves its intent: to `reconciled` once
 * the file holds it, to `failed_check` with `config_moved` when a key it names moved since its
 * card, or `config_invalid` when the config now refuses it. The journal and the notice name the
 * caller and surface that tapped Confirm. Applying again after a stop finds the keys at their new
 * values and only moves the intent. Answers the intent as it stands after; any other intent, or
 * one no longer `confirmed`, is answered as it is.
 */
export async function writeConfigChange(
  parts: ConfigChangeWriteParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { record } = snapshot;
  if (record.kind !== "configChange" || record.state !== "confirmed") {
    return snapshot;
  }
  const confirmation = await parts.intents.confirmation(record.id, { signal });
  const author =
    confirmation === undefined
      ? { by: "engine", surface: "engine" }
      : { by: confirmation.byRef, surface: confirmation.bySurface };
  const { patch, reason } = configChangeRequestDocument.decode(record.request);
  const applied = await parts.configChanges.apply(
    { patch, quote: quoteOf(snapshot), ...(reason === undefined ? {} : { reason }) },
    { author, signal },
  );
  const trigger: IntentTrigger = applied.ok
    ? { type: "order_written" }
    : { type: "config_refused", reason: applied.error };
  const step = createIntentStateMachine(parts).apply(snapshot.stored.status, trigger);
  if (!step.ok) {
    return snapshot;
  }
  const move = { intent: record.id, version: snapshot.stored.version, step: step.value };
  const moved = await parts.stored.move({ ...move, by: author.by }, { signal });
  return moved.ok
    ? moved.value
    : ((await parts.stored.snapshot(record.id, { signal })) ?? snapshot);
}
