import type { ProtocolClient } from "@binference/client";
import { BinferenceError, createSecret, type JsonValue } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { createRunningTurns } from "@binference/engine/chat";
import {
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  testAgent,
  testCoin,
  testToken,
} from "@binference/engine/testing";
import type { PushFrame } from "@binference/protocol";
import {
  callsReply,
  fixtureSettings,
  startInProcessRuntime,
  textReply,
} from "@binference/runtime/testing";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { Api } from "grammy";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeSupervisor } from "../agent-runtime/runtime-supervisor.js";
import { makeRuntimeToken } from "../agent-runtime/runtime-token.js";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";

// The runtime skeleton: the owner writes in Telegram (the synthetic Bot API), the message reaches
// the agent runtime through the engine, which starts the runtime as it starts the real one, the
// scripted model proposes a swap with the agent's own tool, its card reaches Telegram, the owner's
// tap fills it on paper, the settle message starts the next turn, and the agent's report reaches
// Telegram. It runs on both test compositions, the self-hosted one and the Cloud-shaped one, which
// read prices and quotes from the fake chain and venue; the engine `binference start` runs reads
// BNB Smart Chain, so it refuses a proposal offline.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const ownerId = 7_012_345_678;
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

/** The pushes of the agent's chat topic, and a wait for the end of its nth turn. */
interface ChatWatch {
  readonly pushes: readonly PushFrame[];
  turnsEnded(count: number): Promise<void>;
}

function watchChat(client: ProtocolClient): ChatWatch {
  const pushes: PushFrame[] = [];
  const waiting: { readonly count: number; readonly resolve: () => void }[] = [];
  const ends = (): number => pushes.filter((push) => push.kind === "chat/turnEnded").length;
  client.subscribe(`chat:${testAgent}`, {
    onPush: (push) => {
      pushes.push(push);
      waiting.filter((wait) => ends() >= wait.count).forEach((wait) => wait.resolve());
    },
    refetch: async () => Promise.resolve(),
  });
  return {
    pushes,
    turnsEnded: async (count) =>
      new Promise((resolve) => {
        waiting.push({ count, resolve });
        if (ends() >= count) {
          resolve();
        }
      }),
  };
}

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
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live());
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const telegram = {
    api,
    owners,
    copies: createMemoryCardCopyStore(),
    botToken: createSecret(fakeBotToken),
  };
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(composition.parts(), { telegram, turns });
  stops.push(async () => skeleton.close());
  await skeleton.client.call("approval/set", { agent: testAgent, mode: "manual" }, live());
  await skeleton.client.call("portfolio/resetPaper", { agent: testAgent }, live());
  const { access } = skeleton.parts.stores;
  const supervisor = createRuntimeSupervisor({
    start: async () =>
      startInProcessRuntime({
        replies,
        signIn: async (start) => skeleton.connect(start.token, "runtime"),
      }),
    makeToken: async (signal) =>
      makeRuntimeToken({ access, clock: skeleton.clock, random: createSeededRandom(21) }, signal),
    startLine: {
      endpoint: "skeleton",
      paths: { agentDb: "agent.sqlite", workspace: "workspace" },
      settings: fixtureSettings,
    },
    turns,
    onRevoked: (tokens) =>
      tokens.forEach((token) => skeleton.composed.server.endSessions(token, "auth.revoked")),
    clock: skeleton.clock,
    logger: skeleton.logger,
  });
  stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  const chat = watchChat(skeleton.client);
  supervisor.begin();
  const { telegram: composed } = skeleton.composed;
  if (composed === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  return { skeleton, botApi, chat, telegram: composed };
}

function ownerText(text: string): JsonValue {
  return {
    update_id: 1,
    message: {
      message_id: 7,
      date: 1_760_000_000,
      chat: { id: ownerId, type: "private" },
      from: { id: ownerId, is_bot: false, first_name: "Owner" },
      text,
    },
  };
}

// The Confirm button of the one card in the owner's chat.
function confirmOf(botApi: FakeBotApi): { readonly data: string; readonly messageId: number } {
  const card = botApi.messages().find((message) => message.buttons.length > 0);
  const data = card?.buttons[0]?.[0]?.data ?? "";
  return { data, messageId: card?.messageId ?? 0 };
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
