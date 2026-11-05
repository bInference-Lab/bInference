import type { JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies, type ReplySettings } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const at = { agent, session: "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab", turn };
const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

// The replies with the reasoning shown as `settings` say, on the synthetic Bot API.
async function setUp(settings: ReplySettings) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const shows = () => settings;
  const replies = createChatReplies({ api, owners, clock, logger, display, replies: shows });
  return { botApi, clock, replies };
}

type Test = Awaited<ReturnType<typeof setUp>>;

function push(kind: string, data: JsonValue) {
  return { kind, data };
}

const started = push("chat/turnStarted", at);
const ended = push("chat/turnEnded", { agent, turn, outcome: "ok" });
const answer = (text: string, final = true) => push("chat/message", { ...at, text, final });
const reasoning = (text: string, final = false) =>
  push("chat/reasoning", { agent, turn, text, final });
const thought = "The owner says hey, so a short greeting fits.";

// Shows a push and moves time so the chat's pace lets each call go.
async function shown(test: Test, given: ReturnType<typeof push>): Promise<void> {
  const showing = test.replies.show(given, live);
  await test.clock.advance(5_000);
  await showing;
  await test.replies.idle();
}

describe("the model's reasoning in Telegram", () => {
  it("shows none of it while it is off", async () => {
    const test = await setUp({ stream: "progress" });
    await test.replies.show(started, live);
    await test.replies.show(reasoning(thought), live);
    await shown(test, reasoning(thought, true));
    await shown(test, answer("Hey!"));
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual(["Hey!"]);
  });

  it("streams it as an italic line under the label, a second and a half after it starts", async () => {
    const test = await setUp({ stream: "progress", reasoning: "streamed" });
    await test.replies.show(started, live);
    await test.replies.show(reasoning("The owner"), live);
    await test.clock.advance(1_400);
    expect(test.botApi.sent()).toStrictEqual([]);
    await test.replies.show(reasoning(thought), live);
    await test.clock.advance(100);
    await test.replies.idle();
    expect(test.botApi.messages()).toMatchObject([
      {
        text: `Working\nReasoning: ${thought}`,
        entities: [{ type: "bold" }, { type: "italic" }],
      },
    ]);
    await shown(test, answer("Hey!"));
    await shown(test, ended);
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual(["Hey!"]);
  });

  it("drops the reasoning line once the text written before a tool shows", async () => {
    const test = await setUp({ stream: "progress", reasoning: "streamed" });
    await test.replies.show(started, live);
    await test.replies.show(answer("Let me check the pool.", false), live);
    await test.replies.show(
      push("chat/progress", { agent, turn, progressKey: "turn.tool.quote" }),
      live,
    );
    await test.replies.show(reasoning(thought), live);
    await test.clock.advance(2_000);
    await test.replies.idle();
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual([
      "Let me check the pool.",
    ]);
  });

  it("keeps a model call's whole reasoning as a message before the answer", async () => {
    const test = await setUp({ stream: "progress", reasoning: "kept" });
    await test.replies.show(started, live);
    await shown(test, reasoning("The owner"));
    await shown(test, reasoning(thought, true));
    await shown(test, answer("Hey!"));
    expect(test.botApi.messages()).toMatchObject([
      {
        text: `Reasoning\n${thought}`,
        entities: [
          { type: "bold", offset: 0, length: 9 },
          { type: "italic", offset: 10 },
        ],
      },
      { text: "Hey!" },
    ]);
  });

  it("streams it in a message of its own in the partial mode, gone once the answer came", async () => {
    const test = await setUp({ stream: "partial", reasoning: "streamed" });
    await test.replies.show(started, live);
    await test.replies.show(reasoning(thought), live);
    await test.clock.advance(0);
    await test.replies.idle();
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual([`Reasoning\n${thought}`]);
    await shown(test, answer("Hey!"));
    await shown(test, ended);
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual(["Hey!"]);
    expect(test.botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: 1001 }]);
  });
});
