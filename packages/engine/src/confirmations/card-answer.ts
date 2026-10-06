import type { Id } from "@binference/core";

/** A surface the owner answers cards on: Telegram, the console, the Mini App or the CLI. */
export type Surface = "telegram" | "console" | "mini" | "cli";

/** Who answered a card: the surface, and the device, token or Telegram user on it. */
export interface Answerer {
  readonly surface: Surface;
  /** The id the ledger records for the one who answered, such as a `dev_` or `tok_` id. */
  readonly by: string;
}

/** The owner's answer to one card: Confirm or Cancel, from one surface. */
export interface CardAnswer {
  readonly intent: Id<"int">;
  readonly decision: "confirm" | "deny";
  /** The card version the owner saw. A Confirm counts only on the current one; Cancel on any. */
  readonly cardVersion: number;
  readonly answeredBy: Answerer;
}
