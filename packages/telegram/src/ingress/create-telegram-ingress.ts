import { BinferenceError, type Clock, type JsonValue, type Logger } from "@binference/core";
import type { AccessStore, InboxEntry, InboxStore } from "@binference/engine";
import { createFormatter, type Formatter, type MessageLocale } from "@binference/i18n";
import type { Api } from "grammy";
import type { OwnerStore } from "../ports.js";
import { screenUpdate } from "../screening/screen-update.js";
import { type ChatUpdate, chatUpdateSchema } from "../updates/chat-update.schema.js";
import type { IngressWords, OwnerUpdateSink } from "./act-on-update.js";
import { createBotCalls } from "./bot-calls.js";
import type { ReplyTarget } from "./decide-update.js";
import { type EntryContext, type EntryOutcome, handleEntry } from "./handle-entry.js";

/**
 * Where Telegram updates come in. Long polling and a webhook relay both feed it, and acknowledge
 * an update to Telegram only after {@link UpdateIntake.receive} resolves.
 */
export interface UpdateIntake {
  /**
   * Screens one update as the Bot API sent it and stores it; resolves once it is stored. Rejects
   * when it cannot be stored, so the update stays unacknowledged and comes again.
   */
  receive(update: JsonValue, options: { readonly signal: AbortSignal }): Promise<void>;
}

/** The Telegram ingress: stores each update before it is acknowledged, then handles it. */
export interface TelegramIngress extends UpdateIntake {
  /** Handles the stored updates not handled yet, oldest first: what a restart resumes. */
  resume(options: { readonly signal: AbortSignal }): Promise<void>;
}

/** The stores the ingress writes. */
export interface IngressStores {
  readonly inbox: InboxStore;
  /** Holds the start codes {@link issueStartCode} issued. */
  readonly access: AccessStore;
  readonly owners: OwnerStore;
}

/** What {@link createTelegramIngress} needs. */
export interface TelegramIngressOptions {
  /** The bot's grammY `Api`; the ingress sends replies and deletes messages through it. */
  readonly api: Api;
  readonly stores: IngressStores;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * The owner's language and timezone. Without a language, a sender's Telegram language decides:
   * `zh` and its variants mean Chinese.
   */
  readonly display: { readonly locale?: MessageLocale; readonly timeZone: string };
  /** Takes the owner's messages and button presses. */
  readonly onOwnerUpdate: OwnerUpdateSink;
}

interface Call {
  readonly signal: AbortSignal;
}

const pageSize = 50;
// One pass handles at most this many pages; the next update or restart picks up the rest.
const maxPages = 20;
const botIdPattern = /^(\d+):/;

function botIdOf(token: string): string {
  const botId = botIdPattern.exec(token)?.[1];
  if (botId === undefined) {
    throw new BinferenceError({
      code: "telegram.bad_token",
      message: "A bot token starts with the bot's numeric id and a colon. Check telegram.botToken.",
    });
  }
  return botId;
}

function wordsFor(display: TelegramIngressOptions["display"]) {
  const formatters: Readonly<Record<MessageLocale, Formatter>> = {
    en: createFormatter({ locale: "en", timeZone: display.timeZone }),
    zh: createFormatter({ locale: "zh", timeZone: display.timeZone }),
  };
  return (key: IngressWords, target: ReplyTarget): string => {
    const isChinese = target.languageCode?.toLowerCase().startsWith("zh") === true;
    const formatter = formatters[display.locale ?? (isChinese ? "zh" : "en")];
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    return formatter.message(key);
  };
}

async function handleInOrder(
  entries: readonly InboxEntry[],
  context: EntryContext,
  call: Call,
): Promise<EntryOutcome> {
  return entries.reduce<Promise<EntryOutcome>>(
    async (previous, entry) =>
      (await previous) === "later" ? "later" : handleEntry(entry, context, call),
    Promise.resolve("handled"),
  );
}

function updateOf(update: JsonValue): ChatUpdate {
  const parsed = chatUpdateSchema.safeParse(update);
  if (!parsed.success) {
    throw new BinferenceError({
      code: "telegram.bad_update",
      message: "An update needs a whole, non-negative update_id to be stored.",
    });
  }
  return parsed.data;
}

// At most one pass runs and one waits; a caller that finds one waiting shares it.
function serialized(pass: (call: Call) => Promise<void>): (call: Call) => Promise<void> {
  let running: Promise<void> = Promise.resolve();
  let waiting: Promise<void> | undefined;
  return (call) => {
    if (waiting !== undefined) {
      return waiting;
    }
    const next = (async (): Promise<void> => {
      await running;
      waiting = undefined;
      await pass(call);
    })();
    waiting = next;
    running = next.catch(() => undefined);
    return next;
  };
}

/**
 * Creates the Telegram ingress for one bot. Each update is screened (a secret is cut to its ids),
 * stored under `tg:<bot id>:<update id>`, and handled after it is stored: pairing by start code,
 * owner checks by numeric id, secrets deleted with a warning, the rest handed to `onOwnerUpdate`.
 * A repeated update id is stored once and handled once.
 */
export function createTelegramIngress(options: TelegramIngressOptions): TelegramIngress {
  const { stores, clock, logger } = options;
  const keyPrefix = `tg:${botIdOf(options.api.token)}:`;
  const context: EntryContext = {
    ...stores,
    calls: createBotCalls(options.api),
    clock,
    logger,
    words: wordsFor(options.display),
    onOwnerUpdate: options.onOwnerUpdate,
  };
  const isOurs = (entry: InboxEntry): boolean =>
    entry.source === "telegram" && entry.sourceKey.startsWith(keyPrefix);
  const passFrom = async (call: Call, pagesLeft: number): Promise<void> => {
    const entries = (await stores.inbox.unhandled(pageSize, call)).filter(isOurs);
    if (entries.length === 0) {
      return;
    }
    const outcome = await handleInOrder(entries, context, call);
    if (outcome === "handled" && pagesLeft > 1) {
      await passFrom(call, pagesLeft - 1);
    }
  };
  const pass = serialized(async (call) => passFrom(call, maxPages));
  return {
    receive: async (update, call) => {
      const parsed = updateOf(update);
      const stored = screenUpdate(update, parsed);
      await stores.inbox.admit(
        {
          source: "telegram",
          sourceKey: `${keyPrefix}${String(parsed.updateId)}`,
          payload: { update: stored.update, isRedacted: stored.isRedacted },
          receivedAtMs: clock.now(),
        },
        call,
      );
      // Stored is what the caller waits for; a failed pass is retried by the next one.
      try {
        await pass(call);
      } catch (error) {
        call.signal.throwIfAborted();
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        logger.error("telegram.pass_failed", { errorCode });
      }
    },
    resume: async (call) => pass(call),
  };
}
