import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";
import type { MadeImageReader } from "./made-photos.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const path = "/owner/.binference/workspace/media/made/2026-11-07/a1b2c3d4e5f60718.png";

const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

async function setUp(madeImage?: MadeImageReader) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const replies = createChatReplies({
    api,
    owners,
    clock,
    logger,
    display,
    ...(madeImage === undefined ? {} : { madeImage }),
  });
  return { botApi, replies };
}

const images = {
  kind: "chat/images",
  data: {
    agent,
    turn,
    prompt: "A frog logo.",
    images: [{ image: "a1b2c3d4e5f60718", contentType: "image/png", bytes: png.byteLength, path }],
  },
};

describe("the images the agent made, in Telegram", () => {
  it("sends each to the owner's chat as a photo of its bytes, captioned with where it was saved", async () => {
    const asked: string[] = [];
    const { botApi, replies } = await setUp(async (made) => {
      asked.push(made.image);
      return Promise.resolve(png);
    });
    await replies.show(images, live);
    const [photo] = botApi.messages();
    expect(photo?.file?.bytes).toStrictEqual(png);
    expect(photo?.text).toBe(`Saved at ${path}`);
    expect(asked).toStrictEqual(["a1b2c3d4e5f60718"]);
  });

  it("sends where an image was saved when the engine no longer holds it", async () => {
    const { botApi, replies } = await setUp(async () => Promise.resolve(undefined));
    await replies.show(images, live);
    const [message] = botApi.messages();
    expect(message?.file).toBeUndefined();
    expect(message?.text).toBe(`Saved at ${path}`);
  });
});
