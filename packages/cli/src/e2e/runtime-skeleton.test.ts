import { BinferenceError } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent, testCoin, testToken } from "@binference/engine/testing";
import { callsReply, textReply } from "@binference/runtime/testing";
import type { FakeBotApi } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import {
  type ChatWatch,
  confirmOf,
  ownerBot,
  ownerId,
  ownerText,
  superviseRuntime,
  watchChat,
} from "./runtime-machine.js";

// The runtime skeleton: the owner writes in Telegram (the synthetic Bot API), the message reaches
// the agent runtime through the engine, which starts the runtime as it starts the real one, the
// scripted model proposes a swap with the agent's own tool, its card reaches Telegram, the owner's
// tap fills it on paper, the settle message starts the next turn, and the agent's report reaches
// Telegram. It runs on both test compositions, the self-hosted one and the Cloud-shaped one, which
// read prices and quotes from the fake chain and venue; the engine `binference start` runs reads
// BNB Smart Chain, so it refuses a proposal offline.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const report = "Bought 2 TKN on paper for 0.000000000001 FAKE.";
const icons = { waiting: String.fromCodePoint(0x1f7e1), paper: String.fromCodePoint(0x1f9ea) };
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()));
});

// The model's two answers for each trade: the proposal the owner asked for, as a swap or as a
// buy of the token, then the report once it filled.
const reason = "You asked for some of the token.";
const trades = [
  {
    kind: "swap",
    replies: [
      callsReply([
        {
          name: "swap",
          args: { from: testCoin, to: testToken, amount: { base: "1000000" }, reason },
        },
      ]),
      textReply(report),
    ],
  },
  {
    kind: "buy",
    replies: [
      callsReply([
        {
          name: "buy",
          args: { token: testToken, spend: { asset: testCoin, base: "1000000" }, reason },
        },
      ]),
      textReply(report),
    ],
  },
] as const;

/** The engine with the owner's bot, and the agent runtime it started. */
interface Machine {
  readonly skeleton: Skeleton;
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly chat: ChatWatch;
}

// The owner's bot on the synthetic Bot API, the agent on paper in manual mode, and the runtime the
// engine starts with a token of its own, in this process, on the scripted model.
async function startMachine(
  composition: (typeof skeletonCompositions)[number],
  replies: (typeof trades)[number]["replies"],
): Promise<Machine> {
  const { botApi, telegram } = await ownerBot();
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(composition.parts(), { telegram, turns });
  stops.push(async () => skeleton.close());
  await skeleton.client.call("approval/set", { agent: testAgent, mode: "manual" }, live());
  await skeleton.client.call("portfolio/resetPaper", { agent: testAgent }, live());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const chat = watchChat(skeleton.client, testAgent);
  const supervisor = superviseRuntime(engine, { turns, script: { replies } });
  stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  const { telegram: composed } = skeleton.composed;
  if (composed === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  return { skeleton, botApi, chat, telegram: composed };
}

describe.each(skeletonCompositions)(
  "the runtime skeleton on the $name composition",
  (composition) => {
    it.each(trades)(
      "fills a $kind the agent proposes from a Telegram chat on paper, and reports it",
      slow,
      async ({ kind, replies }) => {
        const { skeleton, botApi, chat, telegram } = await startMachine(composition, replies);
        await telegram.ingress.receive(ownerText("Buy some of the token"), live());
        await skeleton.clock.advance(300);
        await telegram.chat.idle();
        await chat.turnsEnded(1);
        await telegram.idle();
        const confirm = confirmOf(botApi);
        expect(confirm.data).toMatch(/^bnf1:c:y:/);
        const press = botApi.press({ from: ownerId, ...confirm });
        await telegram.ingress.receive(press, live());
        await chat.turnsEnded(2);
        await telegram.idle();
        expect(chat.pushes.map((push) => push.kind)).toStrictEqual([
          "chat/turnStarted",
          "chat/status",
          "chat/turnEnded",
          "chat/turnStarted",
          "chat/message",
          "chat/turnEnded",
        ]);
        expect(botApi.sent().map(({ text }) => text.split("\n")[0])).toStrictEqual([
          "Working on it · 0 s",
          `${icons.waiting} Confirm ${kind} · main · ${icons.paper} Paper`,
          `${icons.waiting} Waiting for your answer on its card`,
          "Working on it · 0 s",
          report,
        ]);
        expect(botApi.messages().map(({ text, buttons }) => ({ text, buttons }))).toStrictEqual([
          { text: `${icons.paper} Paper fill: 0.000000000001 FAKE → 2 TKN`, buttons: [] },
          { text: `${icons.waiting} Waiting for your answer on its card`, buttons: [] },
          { text: report, buttons: [] },
        ]);
        expect(botApi.deleted().map(({ messageId }) => messageId)).toStrictEqual([1001, 1004]);
      },
    );
  },
);
