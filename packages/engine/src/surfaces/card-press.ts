import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import type { CardSettling } from "./create-card-showings.js";

/** The owner's press of a card's Confirm or Cancel button in Telegram, as the engine receives it. */
export interface CardPress {
  /** The card version's callback reference, from the button's data. */
  readonly ref: string;
  readonly decision: "confirm" | "deny";
  /** The presser's numeric Telegram id; the engine answers only for the owner's. */
  readonly presserId: number;
}

/**
 * How a card stands after a press. `closed`: this press or an earlier answer, or the timer,
 * closed it; every copy becomes the receipt of `closing`, or of what followed a confirmation as
 * the press found it: `paper` once a paper intent recorded its fill, `written` once an unfreeze
 * or an auto order's card took effect, `live` once a live intent ended. `open`: the card waits
 * for another answer, with the reason when a re-quote or its simulation failed. `locked`: a
 * Confirm of a live intent while the engine is locked; the card waits, and the presser is told to
 * run `binference unlock`. `over_cap`: a Confirm that would take the agent past its rolling
 * 24-hour cap (decision 0136); the card waits, and the presser is told why. `unknown`: no card
 * has this reference, the presser is not the owner, or the card closed without a receipt, as a
 * cancel closes it; nothing was answered.
 */
export type CardStanding =
  | ({ readonly status: "closed" } & Omit<CardSettling, "ref">)
  | { readonly status: "open"; readonly reason?: QuoteFailure | SimulationFailure }
  | { readonly status: "locked" }
  | { readonly status: "over_cap" }
  | { readonly status: "unknown" };
