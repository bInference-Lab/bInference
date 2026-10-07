import type { CardClosing, QuoteFailure, SimulationFailure } from "@binference/engine";

/** The owner's press of a card's Confirm or Cancel in Telegram, as the engine receives it. */
export interface CardPress {
  /** The card version's callback reference, from the button's data. */
  readonly ref: string;
  readonly decision: "confirm" | "deny";
  /** The presser's numeric Telegram id; the engine answers only for the owner's. */
  readonly presserId: number;
}

/**
 * How a card stands after a press. `closed`: this press or an earlier answer, or the timer,
 * closed it; every copy becomes the receipt of `closing`. `open`: the card waits for another
 * answer, with the reason when a re-quote or its simulation failed. `unknown`: no card has this
 * reference, or the presser is not the owner; nothing was answered.
 */
export type CardStanding =
  | { readonly status: "closed"; readonly closing: CardClosing }
  | { readonly status: "open"; readonly reason?: QuoteFailure | SimulationFailure }
  | { readonly status: "unknown" };
