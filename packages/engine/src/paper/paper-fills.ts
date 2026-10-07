import { BinferenceError, type Clock } from "@binference/core";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { createIntentStateMachine } from "../intents/state-machine.js";

/**
 * Paper mode's fill step: a confirmed paper intent fills at its confirmed quote, and nothing is
 * signed (ARCHITECTURE.md section 10). The fill is recorded with the move to `paper_filled`, in
 * its event and its ledger entry, and the intent's view shows it as its execution.
 */
export interface PaperFills {
  /**
   * Fills a confirmed paper intent at its confirmed quote: the quote's input for its expected
   * output, at the time of the fill. Any other intent comes back as it was; an intent another
   * write moved first comes back as that write left it.
   */
  fillAtQuote(
    snapshot: IntentSnapshot,
    options: { readonly signal: AbortSignal },
  ): Promise<IntentSnapshot>;
}

/** What paper fills read the time from and write through. */
export interface PaperFillsOptions {
  readonly stored: StoredIntents;
  readonly clock: Clock;
}

function fillOf(snapshot: IntentSnapshot, atMs: number): PaperFill {
  const { quote } = snapshot.record;
  if (quote === undefined) {
    throw new BinferenceError({
      code: "engine.no_quote",
      message: `Confirmed intent ${snapshot.record.id} has no quote to fill at.`,
      details: { intent: snapshot.record.id },
    });
  }
  const confirmed = quoteDocument.decode(quote);
  return { amountIn: confirmed.amountIn, amountOut: confirmed.expectedOut, atMs };
}

/** Creates the {@link PaperFills} on the state machine, which decides whether an intent fills. */
export function createPaperFills(options: PaperFillsOptions): PaperFills {
  const machine = createIntentStateMachine({ clock: options.clock });
  const { stored } = options;
  return {
    async fillAtQuote(snapshot, { signal }) {
      const step = machine.apply(snapshot.stored.status, { type: "paper_fill_recorded" });
      if (!step.ok) {
        return snapshot;
      }
      const fill = fillOf(snapshot, step.value.event.atMs);
      const intent = snapshot.record.id;
      const move = {
        intent,
        version: snapshot.stored.version,
        step: step.value,
        by: "engine",
        fill,
      };
      const moved = await stored.move(move, { signal });
      return moved.ok ? moved.value : ((await stored.snapshot(intent, { signal })) ?? snapshot);
    },
  };
}
