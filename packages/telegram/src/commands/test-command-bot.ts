import { type ChainRegistry, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import type { JsonValue } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
  type MemoryLogger,
} from "@binference/core/testing";
import { type AccessStore, drawCard } from "@binference/engine";
import { issueLaunchTicket } from "@binference/engine/access";
import { createOwnerCalls, type OwnerChatHandlers } from "@binference/engine/surfaces";
import {
  createMemoryAccessStore,
  createMemoryCardCopyStore,
  createMemoryInboxStore,
  createMemoryOwnerStore,
} from "@binference/engine/testing";
import type { MessageLocale } from "@binference/i18n";
import { Api } from "grammy";
import type { CardShowing } from "../cards/create-telegram-cards.js";
import { createTelegramCards } from "../cards/create-telegram-cards.js";
import { createFakeCardAnswers, type FakeCardAnswers } from "../fakes/fake-card-answers.js";
import { createTelegramIngress } from "../ingress/create-telegram-ingress.js";
import type { OwnerUpdate } from "../ingress/decide-update.js";
import { assetsWith, cardIntent, swapFacts } from "../testing/card-fixtures.js";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, textUpdate } from "../testing/update-fixtures.js";
import { createFastCommands, type FastCommands } from "./create-fast-commands.js";

const live = { signal: new AbortController().signal };

/** The fake chain, with its coin FAKE and its token TKN, as the replies name them. */
export function testChains(): ChainRegistry {
  return createChainRegistry({
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

/** A card that waits for the owner: the spec's swap card, with its callback reference. */
export const waitingSwap: CardShowing = {
  intent: cardIntent,
  card: drawCard(swapFacts),
  callbackRef: "q3Zr_x9-AbCdEfGh",
  assets: assetsWith(),
};

/** How a test bot differs from the default: the owner's language and the cards that wait. */
export interface CommandBotOptions {
  readonly locale?: MessageLocale;
  readonly waiting?: readonly CardShowing[];
  /** The Mini App's address `/console` opens; none when left out. */
  readonly miniAppUrl?: string;
}

/** The owner's bot with fast commands over the fake Bot API, and what a test drives it by. */
export interface CommandBot {
  readonly botApi: FakeBotApi;
  readonly commands: FastCommands;
  readonly answers: FakeCardAnswers;
  readonly logger: MemoryLogger;
  /** Where `/console` keeps the hashes of the launch tickets it makes. */
  readonly access: AccessStore;
  /** Every owner message the bot handed on to the agent's chat, where a model would read it. */
  readonly chat: readonly OwnerUpdate[];
  /** Sends a text from the owner, as Telegram delivers it, and waits until it is handled. */
  send(
    text: string,
    fixture?: { readonly isEdit?: boolean; readonly isForwarded?: boolean },
  ): Promise<void>;
  /** Hands an update to the bot as Telegram delivers it. */
  receive(update: JsonValue): Promise<void>;
  /** The texts the bot sent to the owner, in order. */
  texts(): readonly string[];
}

// The bot's parts around its commands: the fake Bot API, the owner, the cards and their answers.
async function partsOf(options: CommandBotOptions) {
  const botApi = createFakeBotApi();
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const answers = createFakeCardAnswers({ clock, ownerId });
  const display = () => ({ locale: options.locale ?? "en", timeZone: "UTC" }) as const;
  const copies = createMemoryCardCopyStore();
  const cards = createTelegramCards({ api, owners, copies, answers, clock, logger, display });
  const access = createMemoryAccessStore();
  return { botApi, api, owners, clock, logger, answers, display, cards, access };
}

// The fast commands over the test bot's parts, each operation run on `handlers`.
function commandsOf(
  parts: Awaited<ReturnType<typeof partsOf>>,
  given: { readonly handlers: OwnerChatHandlers; readonly options: CommandBotOptions },
): FastCommands {
  const { api, cards, display, logger, access, clock } = parts;
  const { handlers, options } = given;
  return createFastCommands({
    api,
    owners: parts.owners,
    calls: createOwnerCalls({ handlers, ownerId: async () => Promise.resolve(ownerId) }),
    cards,
    waiting: async () => Promise.resolve(options.waiting ?? []),
    chains: testChains(),
    display,
    ...(options.miniAppUrl === undefined ? {} : { miniAppUrl: options.miniAppUrl }),
    issueLaunchTicket: async (request) =>
      issueLaunchTicket({ access, clock, random: createSeededRandom(9) }, request),
    clock,
    logger,
  });
}

/**
 * Starts the owner's bot on the fake Bot API: its fast commands run their operations on
 * `handlers`, as the engine's owner calls run them, its cards answer through the fake card
 * answers, and every other owner message goes to the agent's chat, which the test reads.
 */
export async function startCommandBot(
  handlers: OwnerChatHandlers,
  options: CommandBotOptions = {},
): Promise<CommandBot> {
  const parts = await partsOf(options);
  const { botApi, api, owners, clock, logger, answers, display, cards, access } = parts;
  const commands = commandsOf(parts, { handlers, options });
  const chat: OwnerUpdate[] = [];
  const ingress = createTelegramIngress({
    api,
    stores: { inbox: createMemoryInboxStore(), access, owners },
    clock,
    logger,
    display,
    onOwnerUpdate: async (update, call) => {
      if (update.kind === "callback") {
        if (!(await commands.press(update, call))) {
          await cards.press(update, call);
        }
      } else if (!(await commands.answer(update, call))) {
        chat.push(update);
      }
    },
  });
  let updateId = 100;
  const receive = async (update: JsonValue): Promise<void> => ingress.receive(update, live);
  return {
    botApi,
    commands,
    answers,
    logger,
    access,
    chat,
    receive,
    send: async (text, fixture = {}) => {
      updateId += 1;
      await receive(textUpdate({ updateId, from: ownerId, text, ...fixture }));
    },
    texts: () => botApi.sent().map((sent) => sent.text),
  };
}
