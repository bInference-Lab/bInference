import { idSchema } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent as agent } from "@binference/engine/testing";
import type { OwnerInfo } from "@binference/protocol";
import { cardAnswersContract } from "@binference/telegram/testing";
import { describe, expect, it } from "vitest";
import {
  answerInCli,
  type Bot,
  bot,
  buyUnlisted,
  createOrder,
  inAutoMode,
  never,
  ownerId,
  propose,
  stopLossUnlisted,
} from "./test-bot.js";

const live = { signal: new AbortController().signal };
const icons = {
  paper: String.fromCodePoint(0x1f9ea),
  refused: String.fromCodePoint(0x274c),
};
const runtimeToken = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000021");
const runtime: EngineCaller = {
  credential: runtimeToken,
  client: { kind: "runtime", version: "test" },
  scopes: ["read", "propose", "agent"],
};

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

  it("says on the card why auto mode asks, naming the MCP client that proposed", async () => {
    const test = await bot();
    await inAutoMode(test);
    await propose(test);
    await test.telegram.idle();
    const [card] = test.botApi.messages().map(({ text }) => text.split("\n"));
    expect(card?.at(-3)).toBe("Auto mode asks you here: proposed from mcp");
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

  it("shows an order card for a token the registry does not list by what it answered", async () => {
    const test = await bot({ knowsUnlisted: true });
    await createOrder(test, stopLossUnlisted);
    await test.telegram.idle();
    const [card] = test.botApi.messages().map(({ text }) => text.split("\n")[1]);
    expect(card).toMatch(
      /^Approve Stop-loss: sell all your XVS \(0x0000000f\) when the price falls to \$0\.80 · /,
    );
    expect(test.logger.records().filter((record) => record.level !== "info")).toStrictEqual([]);
  });

  it("shows a buy card for a token the registry does not list, then its receipt", async () => {
    const test = await bot({ knowsUnlisted: true });
    const { intent } = await propose(test, buyUnlisted);
    await test.telegram.idle();
    const [card] = test.botApi.messages().map(({ text }) => text);
    await answerInCli(test, intent, "confirm");
    await test.telegram.idle();
    const [receipt] = test.botApi.messages().map(({ text }) => text);
    expect(card).toContain("Buy XVS (0x0000000f) with 0.01 FAKE");
    expect(card).toContain("Not a verified token");
    expect(receipt).toMatch(/^.+ Paper fill: 0\.01 FAKE → 0\.02 XVS \(0x0000000f\)$/u);
  });
});
