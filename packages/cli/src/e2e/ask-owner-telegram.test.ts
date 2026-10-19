import { BinferenceError } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent } from "@binference/engine/testing";
import {
  callsReply,
  createSharedScript,
  type SharedScript,
  textReply,
} from "@binference/runtime/testing";
import type { FakeBotApi } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import { ownerTexts } from "./first-chat-machine.js";
import {
  type ChatWatch,
  confirmOf,
  ownerBot,
  ownerId,
  ownerText,
  superviseRuntime,
  watchChat,
} from "./runtime-machine.js";

// The agent's question in Telegram (the synthetic Bot API): the owner writes, the runtime's
// ask_owner asks, the bot shows the question with one button per choice, the owner's press goes
// to the agent once as its next message, and the question shows the answer without buttons.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()));
});

const question = { text: "How long do you like to hold a token?", choices: ["Hours", "Days"] };

/** The engine with the owner's bot, the runtime it started, and the model's script. */
interface Machine {
  readonly skeleton: Skeleton;
  readonly bot: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly chat: ChatWatch;
  readonly script: SharedScript;
}

// The self-hosted engine with the owner's bot on the synthetic Bot API, and the runtime on a model
// that asks, then takes the answer.
async function startMachine(): Promise<Machine> {
  const [composition] = skeletonCompositions;
  const { botApi, telegram } = await ownerBot();
  const turns = createRunningTurns();
  if (composition === undefined) {
    throw new BinferenceError({ code: "test.no_engine", message: "The skeleton has an engine." });
  }
  const skeleton = await startSkeleton(composition.parts(), { telegram, turns });
  stops.push(async () => skeleton.close());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const chat = watchChat(skeleton.client, testAgent);
  const script = createSharedScript([
    callsReply([{ id: "ask", name: "ask_owner", args: question }]),
    textReply("Hours it is."),
  ]);
  const supervisor = superviseRuntime(engine, { turns, script: { replies: script.replies } });
  stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  const bot = skeleton.composed.telegram;
  if (bot === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  return { skeleton, bot, botApi, chat, script };
}

describe("the agent's question in Telegram", () => {
  it("shows the buttons, and a press starts the next turn once with its label", slow, async () => {
    const { skeleton, bot, botApi, chat, script } = await startMachine();
    await bot.ingress.receive(ownerText("Ask me first"), live());
    await skeleton.clock.advance(300);
    await bot.chat.idle();
    await chat.turnsEnded(1);
    await bot.idle();
    expect(botApi.messages()).toContainEqual(
      expect.objectContaining({
        chatId: ownerId,
        text: "main asks\nHow long do you like to hold a token?\nOr write your own answer.",
      }),
    );
    const hours = confirmOf(botApi);
    await bot.ingress.receive(botApi.press({ from: ownerId, ...hours }), live());
    await chat.turnsEnded(2);
    await bot.idle();

    expect(script.requests).toHaveLength(2);
    expect(ownerTexts(script.requests[1])).toStrictEqual(["Ask me first", "Hours"]);
    expect(botApi.messages().map(({ text, buttons }) => ({ text, buttons }))).toContainEqual({
      text: "main asks\nHow long do you like to hold a token?\nAnswered: Hours",
      buttons: [],
    });
    expect(botApi.sent().map(({ text }) => text)).toContain("Hours it is.");
  });
});
