import type { UnsignedTx } from "@binference/chain";
import type { Id } from "@binference/core";
import type { QuoteView, SimulationView } from "@binference/protocol";
import type { CardRules } from "../intents/card-rules.js";
import type { IntentStatus } from "../intents/intent-status.js";
import type { ConfirmationRecord } from "../intents/intent-trigger.js";
import type { IntentStep } from "../intents/state-machine.js";
import type { CardClosing } from "./card-closing.js";

/** A venue's new quote for an intent, and the unsigned steps built from it, their decode checked. */
export interface BuiltQuote {
  readonly quote: QuoteView;
  readonly steps: readonly UnsignedTx[];
}

/** A re-quote at a tap: the built quote and the simulation of its steps. */
export interface Requote extends BuiltQuote {
  readonly simulation: SimulationView;
}

/** An intent as the confirmation store holds it. */
export interface StoredIntent {
  readonly intent: Id<"int">;
  readonly status: IntentStatus;
  /** The row version. A write carries the version it read and fails once the row moves on. */
  readonly version: number;
  /** The card rules of the intent's agent, read with the intent. */
  readonly cards: CardRules;
  /** How the current card closed, once it has. */
  readonly closing?: CardClosing;
  /** The owner's confirmation, once recorded. An intent has at most one. */
  readonly confirmation?: ConfirmationRecord;
}

/** One transition to store, under the row version read before it was decided. */
export interface IntentWrite {
  readonly intent: Id<"int">;
  readonly version: number;
  /**
   * The new status and the event that records the move. A status with a new card version opens
   * that version and closes the one before.
   */
  readonly step: IntentStep;
  /** The card closes on the first answer, whose answerer is the event's cause, or on its timer. */
  readonly closing?: CardClosing;
  readonly confirmation?: ConfirmationRecord;
  /** A re-quote's quote, steps and simulation, which replace the intent's own. */
  readonly requote?: Requote;
}
