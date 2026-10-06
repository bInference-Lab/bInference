/** A surface the owner answers cards on: Telegram, the console, the Mini App or the CLI. */
export type Surface = "telegram" | "console" | "mini" | "cli";

/** Who answered a card: the surface, and the device, token or Telegram user on it. */
export interface Answerer {
  readonly surface: Surface;
  /** The id the ledger records for the one who answered, such as a `dev_` or `tok_` id. */
  readonly by: string;
}
