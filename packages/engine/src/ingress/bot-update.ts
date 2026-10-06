import type { JsonValue } from "@binference/core";

/**
 * One inbound update of a chat bot, as its source hands it over: the id the bot's platform gave it,
 * which grows with each update, and the update as that platform sent it.
 */
export interface BotUpdate {
  readonly updateId: number;
  readonly payload: JsonValue;
}
