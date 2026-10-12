import { BinferenceError, createSecret, type Id, idSchema } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import {
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  testAgent as agent,
  testCoin as coin,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import type { IntentRequest, OwnerInfo } from "@binference/protocol";
import {
  cardAnswersContract,
  createFakeBotApi,
  type FakeBotApi,
  fakeBotToken,
} from "@binference/telegram/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import type { ComposedTelegram } from "./compose-telegram.js";
import { type ComposedSkeleton, composeSkeleton, skeletonCompositions } from "./test-skeleton.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;
const icons = {
  paper: String.fromCodePoint(0x1f9ea),
  refused: String.fromCodePoint(0x274c),
};
const callers: Readonly<Record<"cli" | "mcp", EngineCaller>> = {
  cli: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    client: { kind: "cli", version: "test" },
    scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  },
  mcp: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000002",
    client: { kind: "mcp", version: "test" },
    scopes: ["read", "propose"],
  },
};
const runtimeToken = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000021");
const runtime: EngineCaller = {
  credential: runtimeToken,
  client: { kind: "runtime", version: "test" },
  scopes: ["read", "propose", "agent"],
};
const swap: IntentRequest = {
  kind: "swap",
  agent,
  wallet,
  reason: "Rotate into the token",
  from: coin,
  to: token,
  amount: { base: 10n ** 16n },
};
const [selfHosted] = skeletonCompositions;

/** The composed engine with the owner's bot on the synthetic Bot API, the paper money opened. */
interface Bot extends ComposedSkeleton {
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
}

interface BotOptions {
  readonly isPaired?: boolean;
  readonly owner?: () => OwnerInfo;
  readonly turns?: RunningTurns;
}

async function bot(options: BotOptions = {}): Promise<Bot> {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const telegram = {
    api,
    owners,
    copies: createMemoryCardCopyStore(),
    botToken: createSecret(fakeBotToken),
  };
  const owner = options.owner === undefined ? {} : { owner: options.owner };
  const turns = options.turns === undefined ? {} : { turns: options.turns };
  const skeleton = await composeSkeleton(selfHosted?.parts() ?? never(), {
    telegram,
    ...owner,
    ...turns,
  });
  const composed = skeleton.composed.telegram ?? never();
  const { handlers } = skeleton.composed.engine;
  await handlers["portfolio/resetPaper"]({ args: { agent }, caller: callers.cli, ...live });
  return { ...skeleton, telegram: composed, botApi };
}

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

async function propose(test: Bot): Promise<{ readonly intent: Id<"int">; readonly ref: string }> {
  const { handlers } = test.composed.engine;
  const proposed = await handlers["intent/propose"]({ args: swap, caller: callers.mcp, ...live });
  const intent = proposed.ok ? proposed.value.intent : never();
  const [card] = await test.parts.stores.intents.cards(intent, live);
  return { intent, ref: card?.callbackRef ?? never() };
}

async function answerInCli(test: Bot, intent: Id<"int">, verb: "confirm" | "deny") {
  const [card] = await test.parts.stores.intents.cards(intent, live);
  const args = { intent, card: card?.id ?? never(), cardVersion: 1 };
  const { handlers } = test.composed.engine;
  const answered = await handlers[`intent/${verb}`]({ args, caller: callers.cli, ...live });
  expect(answered.ok).toBe(true);
}

// The owner writes to the bot, and the message's batch closes.
async function ownerWrites(test: Bot): Promise<void> {
  const message = {
    update_id: 1,
    message: {
      message_id: 7,
      date: 1_760_000_000,
      chat: { id: ownerId, type: "private" },
      from: { id: ownerId, is_bot: false, first_name: "Owner" },
      text: "How is the market today?",
    },
  };
  await test.telegram.ingress.receive(message, live);
  await test.clock.advance(300);
  await test.telegram.chat.idle();
}

// The owner's message the runtime finds in the agent's inbox.
async function takenMessage(test: Bot) {
  const { handlers } = test.composed.engine;
  const listed = await handlers["inbox/list"]({ args: { agent }, caller: runtime, ...live });
  const [taken] = listed.ok ? listed.value.items : never();
  return taken?.kind === "inbox/message" ? taken : never();
}

describe("the bot joined to the engine", () => {
  it.each(
    cardAnswersContract({
      create: async () => {
        const test = await bot();
        const { ref } = await propose(test);
        return { answers: test.telegram.answers, ref, ownerId };
      },
    }),
  )("answers presses as the card answers contract says: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("shows each new card in the owner's chat with its reference on the buttons", async () => {
    const test = await bot();
    const { ref } = await propose(test);
    await test.telegram.idle();
    expect(test.botApi.messages()).toMatchObject([
      { chatId: ownerId, buttons: [[{ data: `bnf1:c:y:${ref}` }, { data: `bnf1:c:n:${ref}` }]] },
    ]);
  });

  it("shows the next card in the language the owner switched to while the engine runs", async () => {
    const owner: { current: OwnerInfo } = { current: { locale: "en", timezone: "UTC" } };
    const test = await bot({ owner: () => owner.current });
    await propose(test);
    await test.telegram.idle();
    owner.current = { locale: "zh", timezone: "UTC" };
    await propose(test);
    await test.telegram.idle();
    const han = /\p{Script=Han}/u;
    expect(test.botApi.messages().map((message) => han.test(message.text))).toStrictEqual([
      false,
      true,
    ]);
  });

  it("turns the card into the paper fill's receipt when the CLI confirms it", async () => {
    const test = await bot();
    const { intent } = await propose(test);
    await answerInCli(test, intent, "confirm");
    await test.telegram.idle();
    expect(test.botApi.messages()).toMatchObject([
      { text: `${icons.paper} Paper fill: 0.01 FAKE → 20,000,000,000 TKN`, buttons: [] },
    ]);
  });

  it("turns the card into the cancel receipt when the CLI cancels it", async () => {
    const test = await bot();
    const { intent } = await propose(test);
    await answerInCli(test, intent, "deny");
    await test.telegram.idle();
    expect(test.botApi.messages()).toMatchObject([
      { text: `${icons.refused} Cancelled on the CLI`, buttons: [] },
    ]);
  });

  it("shows no card before the owner pairs, and says so in the log", async () => {
    const test = await bot({ isPaired: false });
    const { intent } = await propose(test);
    await test.telegram.idle();
    expect(test.botApi.messages()).toStrictEqual([]);
    expect(test.logger.records()).toContainEqual(
      expect.objectContaining({
        subsystem: "engine.telegram",
        event: "telegram.card_not_shown",
        fields: { intentId: intent, errorCode: "no_owner" },
      }),
    );
  });

  it("logs a card the Bot API refused, and still shows the next one", async () => {
    const test = await bot();
    test.botApi.failNext("sendMessage", { status: 400, description: "Bad Request: no" });
    const refused = await propose(test);
    const next = await propose(test);
    await test.telegram.idle();
    expect(test.logger.records()).toContainEqual(
      expect.objectContaining({
        level: "warn",
        subsystem: "engine.telegram",
        event: "telegram.card_relay_failed",
        fields: { intentId: refused.intent, errorCode: "telegram.api_refused" },
      }),
    );
    expect(test.botApi.messages()).toMatchObject([
      { buttons: [[{ data: `bnf1:c:y:${next.ref}` }, { data: `bnf1:c:n:${next.ref}` }]] },
    ]);
  });

  it("drops what it was relaying once closed, with nothing logged", async () => {
    const test = await bot();
    await test.telegram.close();
    await propose(test);
    await test.telegram.idle();
    expect(test.botApi.messages()).toStrictEqual([]);
    expect(test.logger.records().filter((record) => record.level === "warn")).toStrictEqual([]);
  });

  it("drops a push past 1,000 waiting for Telegram, and logs it", async () => {
    const test = await bot();
    const card = {
      intent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000009",
      card: "crd_0190f1c2-3a4b-7c5d-8e6f-000000000009",
    };
    const push = { topic: "intent", kind: "card/opened", data: card } as const;
    const dropped = () =>
      test.logger.records().filter((record) => record.event === "telegram.card_relay_full");
    Array.from({ length: 1_001 }).forEach(() => test.telegram.relay(push));
    await test.telegram.idle();
    expect(dropped()).toStrictEqual([
      expect.objectContaining({ level: "warn", fields: { intentId: card.intent } }),
    ]);
    Array.from({ length: 1_000 }).forEach(() => test.telegram.relay(push));
    await test.telegram.idle();
    expect(dropped()).toHaveLength(1);
  });

  it("posts the owner's message to the agent as one written in Telegram", async () => {
    const turns = createRunningTurns();
    const test = await bot({ turns });
    await ownerWrites(test);
    turns.startRuntime(runtimeToken);
    const { handlers } = test.composed.engine;
    const listed = await handlers["inbox/list"]({ args: { agent }, caller: runtime, ...live });
    expect(listed).toMatchObject({
      ok: true,
      value: {
        items: [{ kind: "inbox/message", text: "How is the market today?", surface: "telegram" }],
      },
    });
    expect(test.botApi.calls()).toStrictEqual([]);
  });

  it("shows the agent's reply as one edited status message, then the answer", async () => {
    const turns = createRunningTurns();
    const test = await bot({ turns });
    const { handlers } = test.composed.engine;
    await ownerWrites(test);
    turns.startRuntime(runtimeToken);
    const taken = await takenMessage(test);
    const turn = { agent, session: taken.session, turn: taken.turn };
    const start = { ...turn, messages: [taken.message], outsideContent: false };
    await handlers["turn/start"]({ args: start, caller: runtime, ...live });
    await test.telegram.idle();
    await test.clock.advance(1_000);
    await test.telegram.idle();
    const say = { ...turn, text: "Calm: <b>no</b> big moves.", final: true };
    await handlers["turn/say"]({ args: say, caller: runtime, ...live });
    const end = { agent, turn: taken.turn, outcome: "ok" } as const;
    await handlers["turn/end"]({ args: end, caller: runtime, ...live });
    await test.telegram.idle();
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual([
      "Working on it · 0 s",
      "Calm: <b>no</b> big moves.",
    ]);
    expect(test.botApi.edits()).toHaveLength(1);
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual([
      "Calm: <b>no</b> big moves.",
    ]);
  });
});
