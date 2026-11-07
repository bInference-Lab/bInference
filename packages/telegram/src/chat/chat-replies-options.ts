import type { ChainRegistry } from "@binference/chain";
import type { Logger, Clock } from "@binference/core";
import type { OwnerStore } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import type { Api } from "grammy";

/** What `createChatReplies` needs. */
export interface ChatRepliesOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** Who owns the install: the replies go to the owner's private chat. */
  readonly owners: OwnerStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The owner's language and timezone as they are now, read for each message. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
  /**
   * The name of each agent that is not archived, by its id. While there are several, each answer
   * and status line starts with its agent's name (decision 0204); left out, none does.
   */
  readonly agentNames?: (call: {
    readonly signal: AbortSignal;
  }) => Promise<ReadonlyMap<string, string>>;
  /** How replies show as config.json5 holds it now, read as each turn starts; left out, `progress`. */
  readonly replies?: () => ReplySettings;
  /**
   * The chain registry, which names each deposit wallet's chain and its explorer; left out, the
   * engine's chain name shows and no explorer link.
   */
  readonly chains?: ChainRegistry;
}

/**
 * How the agent's replies show while a turn runs (decision 0376): `progress` shows a status
 * message once work starts and the answer as new messages; `partial` grows the answer in one
 * message that becomes the answer in place.
 */
export interface ReplySettings {
  readonly stream: "progress" | "partial";
  /**
   * How the model's reasoning shows (decision 0377): not at all, `streamed` while the agent works,
   * or `kept` as a message of its own before the answer; left out, `off`.
   */
  readonly reasoning?: "off" | "streamed" | "kept";
}
