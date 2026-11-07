import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";
import type { SentFileReader } from "./sent-documents.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const csv = new TextEncoder().encode("date,side\n");
const path = "/owner/.binference/workspace/reports/trades.csv";

const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

async function setUp(sentFile: SentFileReader) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const replies = createChatReplies({ api, owners, clock, logger, display, sentFile });
  return { botApi, replies };
}

const files = {
  kind: "chat/files",
  data: {
    agent,
    turn,
    caption: "This week's trades.",
    files: [{ file: "c3d4e5f607182930", name: "trades.csv", bytes: csv.byteLength, path }],
  },
};

describe("the files the agent sent, in Telegram", () => {
  it("sends each to the owner's chat as a document of its bytes, named and captioned with where it is", async () => {
    const asked: string[] = [];
    const { botApi, replies } = await setUp(async (sent) => {
      asked.push(sent.file);
      return Promise.resolve(csv);
    });
    await replies.show(files, live);
    const [document] = botApi.messages();
    expect(document?.file?.kind).toBe("document");
    expect(document?.file?.bytes).toStrictEqual(csv);
    expect(document?.text).toBe(`Saved at ${path}`);
    expect(asked).toStrictEqual(["c3d4e5f607182930"]);
  });

  it("sends where a file is when the engine no longer holds it", async () => {
    const { botApi, replies } = await setUp(async () => Promise.resolve(undefined));
    await replies.show(files, live);
    const [message] = botApi.messages();
    expect(message?.file).toBeUndefined();
    expect(message?.text).toBe(`Saved at ${path}`);
  });
});
