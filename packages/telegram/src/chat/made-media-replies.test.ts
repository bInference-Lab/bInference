import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";
import type { MediaReader } from "./made-media-messages.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const opus = new TextEncoder().encode("OggS opus pages");
const videoPath = "/owner/.binference/workspace/media/made/2026-11-08/d4e5f60718293a4b.mp4";
const speechPath = "/owner/.binference/workspace/media/speech/2026-11-08/e5f60718293a4b5c.ogg";

const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

async function setUp(media: MediaReader) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const replies = createChatReplies({ api, owners, clock, logger, display, media });
  return { botApi, replies };
}

const video = {
  kind: "chat/media",
  data: {
    agent,
    turn,
    media: {
      media: "d4e5f60718293a4b",
      kind: "video",
      contentType: "video/mp4",
      bytes: mp4.byteLength,
      path: videoPath,
    },
  },
};

const voice = {
  kind: "chat/media",
  data: {
    agent,
    turn,
    media: {
      media: "e5f60718293a4b5c",
      kind: "voice",
      contentType: "audio/ogg",
      bytes: opus.byteLength,
      path: speechPath,
    },
  },
};

describe("the videos and speech the agent made, in Telegram", () => {
  it("sends a video Telegram plays in place, captioned with where it was saved", async () => {
    const asked: string[] = [];
    const { botApi, replies } = await setUp(async (made) => {
      asked.push(made.media);
      return Promise.resolve(mp4);
    });
    await replies.show(video, live);
    const [message] = botApi.messages();
    expect(message?.file?.kind).toBe("video");
    expect(message?.file?.bytes).toStrictEqual(mp4);
    expect(message?.text).toBe(`Saved at ${videoPath}`);
    expect(asked).toStrictEqual(["d4e5f60718293a4b"]);
  });

  it("sends speech as a voice note with no caption, so its words are never read twice", async () => {
    const { botApi, replies } = await setUp(async () => Promise.resolve(opus));
    await replies.show(voice, live);
    const [message] = botApi.messages();
    expect(message?.file?.kind).toBe("voice");
    expect(message?.file?.bytes).toStrictEqual(opus);
    expect(message?.text).toBe("");
  });

  it("sends where a medium was saved when the engine no longer holds it or it is over 50 MB", async () => {
    const gone = await setUp(async () => Promise.resolve(undefined));
    await gone.replies.show(voice, live);
    expect(gone.botApi.messages().map((each) => each.text)).toStrictEqual([
      `Saved at ${speechPath}`,
    ]);
    const huge = await setUp(async () => Promise.resolve(new Uint8Array(50_000_001)));
    await huge.replies.show(video, live);
    const [message] = huge.botApi.messages();
    expect(message?.file).toBeUndefined();
    expect(message?.text).toBe(`Saved at ${videoPath}`);
    const asked: string[] = [];
    const named = await setUp(async (made) => {
      asked.push(made.media);
      return Promise.resolve(mp4);
    });
    const large = {
      ...video,
      data: { ...video.data, media: { ...video.data.media, bytes: 60_000_000 } },
    };
    await named.replies.show(large, live);
    expect(named.botApi.messages().map((each) => each.text)).toStrictEqual([
      `Saved at ${videoPath}`,
    ]);
    expect(asked).toStrictEqual([]);
  });
});
