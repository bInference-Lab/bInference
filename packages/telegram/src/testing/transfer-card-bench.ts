import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { type CardFacts, drawCard } from "@binference/engine";
import type { LiveOutcome } from "@binference/engine/surfaces";
import { createMemoryCardCopyStore, createMemoryOwnerStore } from "@binference/engine/testing";
import type { MessageLocale } from "@binference/i18n";
import { Api } from "grammy";
import { createTelegramCards } from "../cards/create-telegram-cards.js";
import { createFakeCardAnswers } from "../fakes/fake-card-answers.js";
import { chatUpdateSchema } from "../updates/chat-update.schema.js";
import { cardExpiresAtMs, cardIntent } from "./card-fixtures.js";
import { createFakeBotApi, fakeBotToken } from "./fake-bot-api.js";
import { transferAssets } from "./transfer-card-fixtures.js";
import { ownerId } from "./update-fixtures.js";

const live = { signal: new AbortController().signal };
const ref = "q3Zr_x9-AbCdEfGh";

/** How the engine answers the owner's Confirm: it takes it, or it leaves the card open and why. */
export type TransferPress = "confirmed" | "locked" | "over_cap";

/** What the owner's chat showed: the card's text, and the answer to a press of its Confirm. */
export interface ShownTransfer {
  readonly lines: readonly string[];
  readonly answer?: string;
}

// The card drawn from `facts`, shown in the owner's chat on the synthetic Bot API in `locale`.
async function shown(locale: MessageLocale, facts: CardFacts) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(cardExpiresAtMs - 30_000);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const answers = createFakeCardAnswers({ clock, ownerId });
  const cards = createTelegramCards({
    api: new Api(fakeBotToken, { fetch: botApi.fetch }),
    owners,
    copies: createMemoryCardCopyStore(),
    answers,
    clock,
    logger: createMemoryLogger({ subsystem: "telegram" }),
    display: () => ({ locale, timeZone: "UTC" }),
  });
  answers.open(ref);
  const card = drawCard(facts);
  await cards.show({ intent: cardIntent, card, callbackRef: ref, assets: transferAssets }, live);
  return { botApi, clock, answers, cards };
}

/**
 * Shows a card drawn from `facts` in the owner's chat on the synthetic Bot API in `locale`, in
 * UTC, and answers what the chat shows; with `press`, the owner then presses Confirm and the
 * engine answers it that way.
 */
export async function showTransferCard(
  locale: MessageLocale,
  facts: CardFacts,
  press?: TransferPress,
): Promise<ShownTransfer> {
  const { botApi, answers, cards } = await shown(locale, facts);
  const lines = (botApi.messages()[0]?.text ?? "").split("\n");
  if (press === undefined) {
    return { lines };
  }
  if (press !== "confirmed") {
    answers.refuseNext(ref, press);
  }
  const update = botApi.press({ from: ownerId, data: `bnf1:c:y:${ref}`, messageId: 1001 });
  const parsed = chatUpdateSchema.parse(update);
  if (parsed.kind !== "callback") {
    throw new BinferenceError({
      code: "test.bad_fixture",
      message: "The press is no button press.",
    });
  }
  await cards.press(parsed, live);
  const answer = botApi.answers()[0]?.text;
  return answer === undefined ? { lines } : { lines, answer };
}

/**
 * Shows a card drawn from `facts` in the owner's chat in `locale`, confirmed in the console, then
 * settles it with how the live intent ended, `outcome`, as the relay does once the engine pushes
 * the move: answers the text the chat's copy shows then.
 */
export async function settleTransferCard(
  locale: MessageLocale,
  facts: CardFacts,
  outcome: LiveOutcome,
): Promise<string> {
  const { botApi, clock, cards } = await shown(locale, facts);
  const answeredBy = { surface: "console", by: "dev_console" } as const;
  const closing = { outcome: "confirmed", answeredBy, atMs: clock.now() } as const;
  const receipt = { outcome, assets: transferAssets };
  await cards.settle({ ref, closing, live: receipt }, live);
  return botApi.messages()[0]?.text ?? "";
}
