import type { ChainRegistry } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  type Id,
  idSchema,
  type LogFields,
  type Logger,
} from "@binference/core";
import type { AnswerCard, EnginePush, EngineStores } from "@binference/engine";
import {
  type CardSettling,
  type CardShowings,
  type CardVersionRef,
  createCardPresses,
  createCardShowings,
  createOwnerCalls,
  type EngineHandlerTable,
  type Notice,
  noticeSchema,
} from "@binference/engine/surfaces";
import type { OwnerInfo } from "@binference/protocol";
import {
  type CardAnswers,
  type CardCopyStore,
  createFastCommands,
  createTelegramCards,
  createTelegramIngress,
  createTelegramNotices,
  type FastCommands,
  type OwnerCalls,
  type OwnerStore,
  type TelegramCards,
  type TelegramIngress,
  type TelegramNotices,
} from "@binference/telegram";
import type { Api } from "grammy";
import { z } from "zod";

/** The owner's bot as the engine serves it. */
export interface TelegramParts {
  /** The bot's grammY `Api`, with its token's throttler installed (`createBotThrottlers`). */
  readonly api: Api;
  /** Who owns the install: only the owner's numeric Telegram id counts. */
  readonly owners: OwnerStore;
  /** Where each card version was posted, so every copy can become its receipt. */
  readonly copies: CardCopyStore;
}

/**
 * What the bot is joined to: the engine's stores, its answer step, the handlers its fast commands
 * run and the owner's display.
 */
export interface TelegramWiring {
  readonly stores: EngineStores;
  readonly answer: AnswerCard;
  /** The engine's handlers and the composition root's, such as `engine/status`. */
  readonly handlers: EngineHandlerTable;
  readonly chains: ChainRegistry;
  /** The owner's language and timezone now, read for each message the bot sends. */
  readonly owner: () => OwnerInfo;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The owner's bot joined to the engine: its cards, where its updates come in, and the relay. */
export interface ComposedTelegram {
  readonly cards: TelegramCards;
  /** The engine's side of each press: the owner's only, stored before Telegram hears back. */
  readonly answers: CardAnswers;
  /** The engine's side of the fast commands: each operation runs for the owner alone. */
  readonly calls: OwnerCalls;
  /** The owner's fast commands; whoever starts the bot registers their menu. */
  readonly commands: FastCommands;
  /** Where the bot's updates come in: long polling and a webhook relay both feed it. */
  readonly ingress: TelegramIngress;
  /**
   * Takes one engine push. A card version that opens is shown in the owner's chat, and one that
   * closes on another surface or by its timer becomes its receipt there, with the paper fill once
   * a paper intent records it; each notice of spec 4, section 4 is sent there in the owner's
   * language; all in the order the pushes came. A failure is logged and never reaches the engine;
   * past 1,000 pushes waiting, a push is dropped and logged. Nothing is kept across a restart.
   */
  relay(push: EnginePush): void;
  /** Resolves once every push relayed so far reached Telegram, or failed and was logged. */
  idle(): Promise<void>;
  /** Stops the relay: aborts the Bot API calls in flight and waits for them to end. */
  close(): Promise<void>;
}

const openedSchema: z.ZodType<CardVersionRef> = z.object({
  intent: idSchema("int"),
  card: idSchema("crd"),
});
const movedSchema = z.object({ intent: idSchema("int"), state: z.string().optional() });

/** What the relay does for one push: show a card version, settle an intent's card, or notify. */
type RelayWork =
  | { readonly kind: "show"; readonly ref: CardVersionRef }
  | { readonly kind: "settle"; readonly intent: Id<"int"> }
  | { readonly kind: "notify"; readonly notice: Notice };

interface RelayContext {
  readonly showings: CardShowings;
  readonly cards: TelegramCards;
  readonly notices: TelegramNotices;
  readonly logger: Logger;
}

// The notices of spec 4, section 4. An auto trade's receipt names its intent instead, and is drawn
// from the stored intent, which no surface does yet.
const noticeArea = "notice.";

interface Call {
  readonly signal: AbortSignal;
}

// A card version that opens is shown. One that closes is settled, and so is a paper intent's card
// once the intent records its fill, which the receipt shows.
function noticeWorkOf(push: EnginePush): RelayWork | undefined {
  const notice = noticeSchema.safeParse(push.data);
  return notice.success && notice.data.key.startsWith(noticeArea)
    ? { kind: "notify", notice: notice.data }
    : undefined;
}

function workOf(push: EnginePush): RelayWork | undefined {
  if (push.kind === "notice/new") {
    return noticeWorkOf(push);
  }
  if (push.kind === "card/opened") {
    const opened = openedSchema.safeParse(push.data);
    return opened.success ? { kind: "show", ref: opened.data } : undefined;
  }
  const moved = movedSchema.safeParse(push.data);
  const settles =
    push.kind === "card/closed" ||
    (push.kind === "intent/changed" && moved.data?.state === "paper_filled");
  return moved.success && settles ? { kind: "settle", intent: moved.data.intent } : undefined;
}

// A Confirm or Cancel pressed in Telegram turns the pressed card into its receipt itself.
function isTelegramAnswer(settling: CardSettling): boolean {
  const { closing } = settling;
  return closing.outcome !== "expired" && closing.answeredBy.surface === "telegram";
}

async function show(context: RelayContext, ref: CardVersionRef, call: Call): Promise<void> {
  const showing = await context.showings.opened(ref, call);
  if (showing === undefined) {
    return;
  }
  const shown = await context.cards.show(showing, call);
  if (!shown.ok) {
    context.logger.info("telegram.card_not_shown", {
      intentId: ref.intent,
      errorCode: shown.error,
    });
  }
}

async function settle(context: RelayContext, intent: Id<"int">, call: Call): Promise<void> {
  const settling = await context.showings.settled(intent, call);
  if (settling !== undefined && !isTelegramAnswer(settling)) {
    await context.cards.settle(settling, call);
  }
}

async function notify(context: RelayContext, notice: Notice, call: Call): Promise<void> {
  const sent = await context.notices.send(notice, call);
  if (!sent.ok) {
    context.logger.info("telegram.notice_not_sent", { ...fieldsOf(notice), errorCode: sent.error });
  }
}

function fieldsOf(notice: Notice): LogFields {
  const { agent, intent } = notice;
  return {
    ...(agent === undefined ? {} : { agentId: agent }),
    ...(intent === undefined ? {} : { intentId: intent }),
  };
}

// The ids a work's log lines name, never the text of a notice.
function workFields(work: RelayWork): LogFields {
  if (work.kind === "notify") {
    return fieldsOf(work.notice);
  }
  return { intentId: work.kind === "show" ? work.ref.intent : work.intent };
}

async function perform(context: RelayContext, work: RelayWork, call: Call): Promise<void> {
  if (work.kind === "notify") {
    await notify(context, work.notice, call);
    return;
  }
  await (work.kind === "show" ? show(context, work.ref, call) : settle(context, work.intent, call));
}

async function run(context: RelayContext, work: RelayWork, call: Call): Promise<void> {
  try {
    await perform(context, work, call);
  } catch (error) {
    // A stopped relay drops what it was sending; nothing failed.
    if (call.signal.aborted) {
      return;
    }
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    const event =
      work.kind === "notify" ? "telegram.notice_not_sent" : "telegram.card_relay_failed";
    context.logger.warn(event, { ...workFields(work), errorCode });
  }
}

/** The relay part of {@link ComposedTelegram}. */
type CardRelay = Pick<ComposedTelegram, "relay" | "idle" | "close">;

// Pushes wait in one line, in order; past this many waiting, a push is dropped and logged, and
// the card or notice stays on the other surfaces.
const maxWaiting = 1_000;

function createCardRelay(context: RelayContext): CardRelay {
  const stop = new AbortController();
  let relayed: Promise<void> = Promise.resolve();
  let waiting = 0;
  return {
    relay(push) {
      const work = workOf(push);
      if (work === undefined) {
        return;
      }
      if (waiting >= maxWaiting) {
        context.logger.warn("telegram.card_relay_full", workFields(work));
        return;
      }
      waiting += 1;
      const before = relayed;
      relayed = (async () => {
        await before;
        await run(context, work, { signal: stop.signal });
        waiting -= 1;
      })();
    },
    idle: async () => relayed,
    async close() {
      stop.abort();
      await relayed;
    },
  };
}

// The owner's numeric Telegram id, read for each press and command.
function answersOwner(parts: TelegramParts) {
  return async (call: Call): Promise<number | undefined> => (await parts.owners.get(call))?.userId;
}

/**
 * Joins the owner's bot to the engine: cards whose presses the engine answers (the owner's
 * numeric Telegram id only, stored before Telegram hears back), the ingress that hands the
 * owner's presses to them, and the relay that shows each new card version in the owner's chat.
 * The owner's chat messages are stored in the inbox and go no further until the agent runtime
 * joins.
 */
export function composeTelegram(parts: TelegramParts, wiring: TelegramWiring): ComposedTelegram {
  const { stores, chains, logger } = wiring;
  const display = () => {
    const { locale, timezone } = wiring.owner();
    return { locale, timeZone: timezone };
  };
  const answers = createCardPresses({
    intents: stores.intents,
    answer: wiring.answer,
    ownerId: answersOwner(parts),
    chains,
  });
  const cards = createTelegramCards({ ...parts, answers, logger, display });
  const showings = createCardShowings({ intents: stores.intents, agents: stores.agents, chains });
  const calls = createOwnerCalls({ handlers: wiring.handlers, ownerId: answersOwner(parts) });
  const commands = createFastCommands({
    api: parts.api,
    calls,
    cards,
    waiting: async (call) => showings.waiting(call),
    chains,
    display,
    logger,
  });
  const ingress = createTelegramIngress({
    api: parts.api,
    stores: { inbox: stores.inbox, access: stores.access, owners: parts.owners },
    clock: wiring.clock,
    logger,
    display,
    // A fast command is answered here; any other message waits for the agent runtime.
    onOwnerUpdate: async (update, call) => {
      if (update.kind === "callback") {
        await cards.press(update, call);
        return;
      }
      await commands.answer(update, call);
    },
  });
  const notices = createTelegramNotices({ ...parts, chains, display });
  const context: RelayContext = { showings, cards, notices, logger };
  return { cards, answers, calls, commands, ingress, ...createCardRelay(context) };
}
