import type { JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import type { MessageLocale } from "@binference/i18n";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const at = { agent, session: "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab", turn };

async function setUp(
  options: {
    readonly locale?: MessageLocale;
    readonly isPaired?: false;
    readonly names?: ReadonlyMap<string, string>;
  } = {},
) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const display = () => ({ locale: options.locale ?? "en", timeZone: "UTC" }) as const;
  const { names } = options;
  const agentNames = names === undefined ? {} : { agentNames: async () => Promise.resolve(names) };
  const replies = createChatReplies({ api, owners, clock, logger, display, ...agentNames });
  return { botApi, clock, logger, replies };
}

function push(kind: string, data: JsonValue) {
  return { kind, data };
}

const started = push("chat/turnStarted", at);
const ended = push("chat/turnEnded", { agent, turn, outcome: "ok" });
const answer = (text: string, final = true) => push("chat/message", { ...at, text, final });
const tool = (progressKey: string, values?: Readonly<Record<string, string>>) =>
  push("chat/progress", { agent, turn, progressKey, ...(values === undefined ? {} : { values }) });
const noAnswer = "No response generated. Please try again.";
const flood = (retryAfterS: number) => ({
  status: 429,
  description: "Too Many Requests",
  retryAfterS,
});

// The Bot API methods called, the typing indicator's left out.
function messageCalls(botApi: ReturnType<typeof createFakeBotApi>): readonly string[] {
  return botApi
    .calls()
    .map(({ method }) => method)
    .filter((method) => method !== "sendChatAction");
}

// Moves time 100 ms at a time; answers how many `sendMessage` calls were made after each step.
async function triesEach100Ms(
  botApi: ReturnType<typeof createFakeBotApi>,
  clock: ReturnType<typeof createManualClock>,
  steps: number,
): Promise<readonly number[]> {
  const tries: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- time moves one step at a time
    await clock.advance(100);
    tries.push(botApi.calls().filter(({ method }) => method === "sendMessage").length);
  }
  return tries;
}

describe("the agent's status message in Telegram", () => {
  it("posts no status message for an answer within a second and a half", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_400);
    await replies.show(answer("Done."), live);
    await replies.show(ended, live);
    await clock.advance(10_000);
    await replies.idle();
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual(["Done."]);
    expect(botApi.edits()).toStrictEqual([]);
  });

  it("shows after a second and a half, edits once a second, and goes 4 s after it showed", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_499);
    expect(botApi.sent()).toStrictEqual([]);
    await clock.advance(1);
    await replies.idle();
    await clock.advance(1_000);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Working on it · 2 s"]);
    expect(botApi.edits()).toHaveLength(1);
    const shown = replies.show(answer("Bought 0.1 BNB of FAKE on paper."), live);
    await clock.advance(1_000);
    await shown;
    await replies.show(ended, live);
    await clock.advance(1_900);
    expect(botApi.deleted()).toStrictEqual([]);
    await clock.advance(100);
    await replies.idle();
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([
      "Working on it · 1 s",
      "Bought 0.1 BNB of FAKE on paper.",
    ]);
    expect(botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: 1001 }]);
    expect(botApi.edits()).toHaveLength(1);
  });

  it("shows at once for a tool, with the text written before it as one line", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await replies.show(answer("Let me look at **your**\nwallet.", false), live);
    await clock.advance(200);
    await replies.show(tool("turn.tool.portfolio"), live);
    await clock.advance(0);
    await replies.idle();
    expect(botApi.messages()).toMatchObject([
      {
        text: "Working on it · 0 s\nLet me look at your wallet.\nReading the portfolio…",
        entities: [{ type: "bold", offset: 35, length: 4 }],
      },
    ]);
  });

  it("edits for a later tool only a second after the last showing", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await replies.show(tool("turn.tool.portfolio"), live);
    await clock.advance(0);
    await replies.idle();
    await replies.show(tool("turn.tool.plugin", { plugin: "fear_index" }), live);
    await clock.advance(900);
    expect(botApi.edits()).toStrictEqual([]);
    await clock.advance(100);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([
      "Working on it · 1 s\nReading the portfolio…\nAsking the plugin fear_index…",
    ]);
  });

  it("keeps the newest 8 work lines and a line repeated in a row once", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    const keys = ["quote", "quote", "chart", "tokenInfo", "tokenRisk", "orders", "txStatus"];
    for (const key of [...keys, "addresses", "portfolio", "marketScan"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the lines come in order
      await replies.show(tool(`turn.tool.${key}`), live);
    }
    await clock.advance(1_000);
    await replies.idle();
    const [shown] = botApi.messages().map(({ text }) => text.split("\n"));
    expect(shown).toStrictEqual([
      "Working on it · 1 s",
      "Reading a chart…",
      "Reading the token…",
      "Checking the token's risk…",
      "Reading the auto orders…",
      "Checking a transaction…",
      "Reading the address book…",
      "Reading the portfolio…",
      "Scanning the market…",
    ]);
  });

  it("draws the agent's text so far as rich text, its end alone when it is long", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    const long = `${"x".repeat(99)}\n`.repeat(60);
    await replies.show(answer(`${long}**Last** line`, false), live);
    await clock.advance(1_500);
    await replies.idle();
    const [shown] = botApi.messages();
    expect(shown?.text.length).toBeLessThanOrEqual(4_096);
    expect(shown?.text.startsWith("Working on it · 1 s\n\n…\n")).toBe(true);
    expect(shown?.text.endsWith("Last line")).toBe(true);
    expect(shown?.entities.at(-1)).toMatchObject({ type: "bold", length: 4 });
  });

  it("sends the status message as plain text when Telegram cannot parse its HTML", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await replies.show(answer("**Checking**", false), live);
    const unparsed = { status: 400, description: "Bad Request: can't parse entities: at 3" };
    botApi.failNext("sendMessage", unparsed, { chatId: ownerId });
    await clock.advance(2_500);
    await replies.idle();
    expect(botApi.messages()).toMatchObject([
      { text: "Working on it · 1 s\n\nChecking", entities: [] },
    ]);
  });

  it("stops editing after Telegram refuses an edit, and still answers and cleans up", async () => {
    const { botApi, clock, logger, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_500);
    await replies.idle();
    botApi.failNext("editMessageText", { status: 400, description: "Bad Request: no rights" });
    await clock.advance(3_000);
    await replies.idle();
    const shown = replies.show(answer("Done."), live);
    await clock.advance(5_000);
    await shown;
    await replies.idle();
    const methods = messageCalls(botApi);
    expect(methods).toStrictEqual([
      "sendMessage",
      "editMessageText",
      "sendMessage",
      "deleteMessage",
    ]);
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Done."]);
    expect(logger.records()).toMatchObject([
      { event: "telegram.preview_stopped", fields: { errorCode: "telegram.api_refused" } },
    ]);
  });

  it("never sends a second status message after the first may have landed", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    botApi.failNext("sendMessage", "lostAnswer", { chatId: ownerId });
    await clock.advance(5_000);
    const methods = messageCalls(botApi);
    expect(methods).toStrictEqual(["sendMessage"]);
  });

  it("tries a status message again whose send never left, and edits it", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    botApi.failNext("sendMessage", "network", { chatId: ownerId });
    await clock.advance(3_500);
    replies.close();
    expect(messageCalls(botApi)).toStrictEqual(["sendMessage", "sendMessage", "editMessageText"]);
  });

  it("drops a preview Telegram answers with a 429, and still delivers the answer", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_500);
    await replies.idle();
    botApi.failNext("editMessageText", flood(3), { chatId: ownerId });
    botApi.failNext("sendMessage", flood(2), { chatId: ownerId });
    await clock.advance(1_000);
    await replies.idle();
    const shown = replies.show(answer("Done."), live);
    await clock.advance(10_000);
    await shown;
    await replies.idle();
    const methods = messageCalls(botApi);
    expect(methods).toStrictEqual([
      "sendMessage",
      "editMessageText",
      "sendMessage",
      "sendMessage",
      "deleteMessage",
    ]);
    expect(botApi.edits()).toStrictEqual([]);
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Done."]);
  });

  it("says in the status message that an answer Telegram refused did not arrive", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_500);
    await replies.idle();
    botApi.failNext("sendMessage", { status: 400, description: "Bad Request: chat not found" });
    const refused = replies.show(answer("**Done.**"), live).catch((error: unknown) => error);
    await clock.advance(5_000);
    expect(await refused).toMatchObject({ code: "telegram.api_refused" });
    await clock.advance(10_000);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([
      "⚠️ The agent's answer did not reach this chat. Read it in the console or with `binference chat` before you ask again.",
    ]);
    expect(botApi.deleted()).toStrictEqual([]);
  });

  it("sends that word as a new message when no status message showed", async () => {
    const { botApi, clock, replies } = await setUp();
    botApi.failNext("sendMessage", { status: 400, description: "Bad Request: chat not found" });
    const refused = replies.show(answer("Done."), live).catch((error: unknown) => error);
    await clock.advance(2_000);
    expect(await refused).toMatchObject({ code: "telegram.api_refused" });
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([
      "⚠️ The agent's answer did not reach this chat. Read it in the console or with `binference chat` before you ask again.",
    ]);
  });

  it("removes an earlier turn's status message when the agent's next turn starts", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_500);
    await replies.idle();
    const next = { ...at, turn: "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ac" };
    await replies.show(push("chat/turnStarted", next), live);
    await clock.advance(5_000);
    replies.close();
    expect(botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: 1001 }]);
    expect(botApi.messages().map(({ messageId }) => messageId)).toStrictEqual([1002]);
  });

  it("removes the status message of a turn that ends without an answer, and says so", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_500);
    await replies.idle();
    const shown = replies.show(ended, live);
    await clock.advance(1_000);
    await shown;
    await clock.advance(4_000);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([noAnswer]);
  });

  it("tells the owner when a turn ends with no answer, no status line and no question", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(500);
    await replies.show(ended, live);
    await clock.advance(10_000);
    await replies.idle();
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([noAnswer]);
  });

  it("adds no such line after a status line or a question of the turn", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    const line = replies.show(push("chat/status", { ...at, statusKey: "turn.stopped" }), live);
    await clock.advance(1_000);
    await line;
    await replies.show(ended, live);
    const next = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ac";
    await replies.show(push("chat/turnStarted", { agent, turn: next }), live);
    await replies.show(push("chat/question", { agent, turn: next, question: "qst_1" }), live);
    await replies.show(push("chat/turnEnded", { agent, turn: next, outcome: "ok" }), live);
    await clock.advance(10_000);
    await replies.idle();
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([
      "Stopped. Anything you already confirmed still goes through.",
    ]);
  });

  it("sends nothing before the owner pairs, and reads no other push", async () => {
    const { botApi, clock, replies } = await setUp({ isPaired: false });
    await replies.show(started, live);
    await replies.show(tool("turn.tool.quote"), live);
    await replies.show(answer("hello"), live);
    await replies.show(push("intent/changed", { intent: "x" }), live);
    await clock.advance(3_000);
    expect(botApi.calls()).toStrictEqual([]);
  });
});

describe("the agent's answers in Telegram", () => {
  it("shows model text holding markup and hidden characters as text", async () => {
    const { botApi, replies } = await setUp();
    const text = `Use <b>bold</b> & <a href="x">this</a>\nnext line ${String.fromCodePoint(0x202e)}`;
    await replies.show(answer(text), live);
    expect(botApi.messages()).toMatchObject([
      {
        text: 'Use <b>bold</b> & <a href="x">this</a>\nnext line \\u{202E}',
        entities: [],
      },
    ]);
  });

  it("shows the agent's Markdown as Telegram's rich text", async () => {
    const { botApi, replies } = await setUp();
    await replies.show(
      answer("You trade in **paper mode**. See [the guide](https://binference.io)."),
      live,
    );
    expect(botApi.messages()).toMatchObject([
      {
        text: "You trade in paper mode. See the guide.",
        entities: [
          { type: "bold", offset: 13, length: 10 },
          { type: "text_link", offset: 29, length: 9 },
        ],
      },
    ]);
  });

  it("sends a piece again as plain text when Telegram cannot parse its HTML, logging its id only", async () => {
    const { botApi, clock, logger, replies } = await setUp();
    botApi.failNext(
      "sendMessage",
      { status: 400, description: "Bad Request: can't parse entities: unsupported start tag" },
      { chatId: ownerId },
    );
    const shown = replies.show(
      answer("**Sold** at [DEX Screener](https://dexscreener.com) & done"),
      live,
    );
    await clock.advance(1_000);
    await shown;
    expect(botApi.messages()).toMatchObject([
      { text: "Sold at DEX Screener (https://dexscreener.com) & done", entities: [] },
    ]);
    expect(logger.records()).toStrictEqual([
      {
        level: "info",
        subsystem: "telegram",
        event: "telegram.chat_sent_plain",
        fields: { messageId: 1001 },
      },
    ]);
  });

  it("splits a long answer at line breaks into messages of 4,096 characters at most", async () => {
    const { botApi, clock, replies } = await setUp();
    const line = "x".repeat(99);
    const shown = replies.show(answer(Array.from({ length: 60 }, () => line).join("\n")), live);
    await clock.advance(1_000);
    await shown;
    expect(botApi.sent().map(({ text }) => text.length)).toStrictEqual([3_999, 1_999]);
  });

  it("shows a status line in italics after the answer", async () => {
    const { botApi, clock, replies } = await setUp();
    const line = push("chat/status", {
      agent,
      turn,
      statusKey: "turn.moreProposals",
      values: { count: 2 },
    });
    const shown = replies.show(line, live);
    await clock.advance(0);
    await shown;
    expect(botApi.messages()).toMatchObject([
      {
        text: "2 more proposals follow once you answer this card",
        entities: [{ type: "italic", offset: 0, length: 49 }],
      },
    ]);
  });

  it("starts each answer and status line with the agent's name while there are several", async () => {
    const names = new Map([
      [agent, "scout"],
      ["agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ac", "main"],
    ]);
    const { botApi, clock, replies } = await setUp({ names });
    const line = { ...at, statusKey: "turn.stopped" };
    const shownAnswer = replies.show(answer("Bought <b>it</b>."), live);
    await clock.advance(0);
    await shownAnswer;
    const shownLine = replies.show(push("chat/status", line), live);
    await clock.advance(1_000);
    await shownLine;
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([
      "scout · Bought <b>it</b>.",
      "scout · Stopped. Anything you already confirmed still goes through.",
    ]);
  });

  it("sends an answer again whose send never left, no sooner than 400 ms later", async () => {
    const { botApi, clock, replies } = await setUp();
    botApi.failNext("sendMessage", "network", { chatId: ownerId });
    botApi.failNext("sendMessage", "network", { chatId: ownerId });
    const shown = replies.show(answer("Done."), live);
    const tries = await triesEach100Ms(botApi, clock, 30);
    await shown;
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual(["Done."]);
    expect(tries.slice(0, 3)).toStrictEqual([1, 1, 1]);
    expect(tries.at(-1)).toBe(3);
  });

  it("stops after 3 tries and says the answer did not arrive", async () => {
    const { botApi, clock, replies } = await setUp();
    for (const failure of ["network", "network", "network"] as const) {
      botApi.failNext("sendMessage", failure, { chatId: ownerId });
    }
    const shown = replies.show(answer("Done."), live).catch((error: unknown) => error);
    await triesEach100Ms(botApi, clock, 40);
    await expect(shown).resolves.toMatchObject({ code: "telegram.unreachable" });
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([
      "⚠️ The agent's answer did not reach this chat. Read it in the console or with `binference chat` before you ask again.",
    ]);
  });

  it("never sends again an answer that may have landed", async () => {
    const { botApi, clock, replies } = await setUp();
    botApi.failNext("sendMessage", "lostAnswer", { chatId: ownerId });
    const shown = replies.show(answer("Done."), live).catch((error: unknown) => error);
    const tries = await triesEach100Ms(botApi, clock, 40);
    await expect(shown).resolves.toBeDefined();
    expect(tries.at(-1)).toBe(2);
    expect(botApi.sent().map(({ text }) => text)).toHaveLength(2);
  });

  it("names no agent while there is one", async () => {
    const { botApi, clock, replies } = await setUp({ names: new Map([[agent, "main"]]) });
    const shown = replies.show(answer("Done."), live);
    await clock.advance(0);
    await shown;
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Done."]);
  });
});
