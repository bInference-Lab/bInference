import { BinferenceError } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent, testCoin, testPng, testToken } from "@binference/engine/testing";
import { maxImageBytes } from "@binference/protocol";
import { callsReply, type InProcessRuntime, textReply } from "@binference/runtime/testing";
import type { FakeBotApi } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import { createSystemHttp } from "../runtime/system-http.js";
import {
  type ChatWatch,
  ownerBot,
  ownerPhoto,
  type RuntimeScript,
  superviseRuntime,
  watchChat,
} from "./runtime-machine.js";

// The owner's images through the whole machine: the owner sends a photo in Telegram (the
// synthetic Bot API, which serves `getFile` and the file), the engine relays the message, the
// runtime reads the photo with `inbox/readImage` and hands it to the scripted model, or to the
// scripted vision model when the model reads no images, and Telegram shows what came of it.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const stops: (() => Promise<void>)[] = [];
const [selfHosted] = skeletonCompositions;
const pngBase64 = Buffer.from(testPng).toString("base64");
const warning = "⚠️ This came after reading outside content (web, X, token data or an image)";

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()));
});

interface Machine {
  readonly skeleton: Skeleton;
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly chat: ChatWatch;
  readonly runtimes: readonly InProcessRuntime[];
}

// The owner's bot holding the photo `AgACchart`, the agent on paper in manual mode, and the runtime
// the engine starts on the scripted models.
async function startMachine(script: RuntimeScript, photo: Uint8Array = testPng): Promise<Machine> {
  if (selfHosted === undefined) {
    throw new BinferenceError({ code: "test.no_composition", message: "The skeleton has one." });
  }
  const { botApi, telegram } = await ownerBot();
  botApi.addFile("AgACchart", { bytes: photo, reportedSize: null });
  const turns = createRunningTurns();
  // The HTTP listener on a free port, as the console uploads through it.
  const browser = { http: { host: "127.0.0.1", port: 0 } };
  const skeleton = await startSkeleton(selfHosted.parts(), { telegram, turns, browser });
  stops.push(async () => skeleton.close());
  await skeleton.client.call("approval/set", { agent: testAgent, mode: "manual" }, live());
  await skeleton.client.call("portfolio/resetPaper", { agent: testAgent }, live());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const chat = watchChat(skeleton.client, testAgent);
  const runtimes: InProcessRuntime[] = [];
  const supervisor = superviseRuntime(engine, { turns, script, started: runtimes });
  stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  const { telegram: composed } = skeleton.composed;
  if (composed === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  return { skeleton, botApi, chat, telegram: composed, runtimes };
}

// The owner sends the photo with a caption, and the turn it starts ends.
async function sendPhoto(machine: Machine, caption: string): Promise<void> {
  const { telegram, skeleton, chat } = machine;
  await telegram.ingress.receive(ownerPhoto({ fileId: "AgACchart", caption }), live());
  await skeleton.clock.advance(300);
  await telegram.chat.idle();
  await chat.turnsEnded(1);
  await telegram.idle();
}

function sentTexts(botApi: FakeBotApi): readonly string[] {
  return botApi.sent().map(({ text }) => text);
}

const reason = "The owner's chart shows the token rising.";
const swap = callsReply([
  { name: "swap", args: { from: testCoin, to: testToken, amount: { base: "1000000" }, reason } },
]);

// The console's way: `upload/start`, the body to its ticket's path, then `chat/post` naming it.
async function uploadAndPost(machine: Machine, text: string): Promise<void> {
  const { skeleton, chat } = machine;
  const address = await skeleton.composed.server.start(AbortSignal.timeout(5_000));
  const plan = { contentType: "image/png", bytes: testPng.byteLength } as const;
  const { url } = await skeleton.client.call("upload/start", plan, live());
  const http = createSystemHttp({ version: "test" });
  stops.push(async () => http.close());
  const posted = await http.request({
    method: "POST",
    url: `http://127.0.0.1:${String(address?.port)}${url}`,
    bodyBytes: testPng,
    signal: AbortSignal.timeout(5_000),
  });
  const { upload } = uploadAnswerSchema.parse(JSON.parse(posted.body));
  await skeleton.client.call("chat/post", { agent: testAgent, text, images: [upload] }, live());
  await chat.turnsEnded(1);
}

const uploadAnswerSchema = z.object({ upload: z.string() });

describe("the owner's images in chat", () => {
  it("reach the model from the console's upload too", slow, async () => {
    const machine = await startMachine({ replies: [textReply("A chart.")], readsImages: true });
    await uploadAndPost(machine, "This chart");
    const asked = machine.runtimes[0]?.transports.main.requests[0]?.messages.at(-1);
    expect(asked).toStrictEqual({
      role: "owner",
      text: "This chart",
      images: [{ contentType: "image/png", data: pngBase64 }],
    });
  });

  it(
    "reach a model that reads images, and the card after them carries the warning",
    slow,
    async () => {
      const machine = await startMachine({ replies: [swap], readsImages: true });
      await sendPhoto(machine, "Buy the token on this chart");
      const asked = machine.runtimes[0]?.transports.main.requests[0]?.messages.at(-1);
      expect(asked).toStrictEqual({
        role: "owner",
        text: "Buy the token on this chart",
        images: [{ contentType: "image/png", data: pngBase64 }],
      });
      const card = sentTexts(machine.botApi).find((text) => text.includes("Confirm swap"));
      expect(card).toContain(warning);
    },
  );

  it(
    "go to the vision model when the model reads none, and its description to the model",
    slow,
    async () => {
      const machine = await startMachine({
        replies: [textReply("It shows the token rising.")],
        visionReplies: [textReply("A price chart of TKN, rising.")],
      });
      await sendPhoto(machine, "What does this show?");
      const transports = machine.runtimes[0]?.transports;
      expect(transports?.vision?.requests[0]?.messages[0]).toMatchObject({
        images: [{ contentType: "image/png", data: pngBase64 }],
      });
      const seen = transports?.main.requests[0]?.messages.slice(-2);
      expect(seen?.[0]).toStrictEqual({ role: "owner", text: "What does this show?" });
      expect(seen?.[1]?.text).toContain("A price chart of TKN, rising.");
      expect(sentTexts(machine.botApi)).toContain("It shows the token rising.");
    },
  );

  it(
    "are refused over 5 MiB with the line that names the limit, before any model call",
    slow,
    async () => {
      const poster = new Uint8Array(maxImageBytes + 1);
      poster.set(testPng.subarray(0, 8));
      const machine = await startMachine({ replies: [swap], readsImages: true }, poster);
      await sendPhoto(machine, "And this one?");
      expect(machine.runtimes[0]?.transports.main.requests).toStrictEqual([]);
      expect(sentTexts(machine.botApi)).toContainEqual(
        expect.stringContaining("Not read: an image is over the 5 MiB limit. Send a smaller one."),
      );
    },
  );

  it(
    "are refused with the line naming the vision model setting when no model reads them",
    slow,
    async () => {
      const machine = await startMachine({ replies: [swap] });
      await sendPhoto(machine, "Look");
      expect(machine.runtimes[0]?.transports.main.requests).toStrictEqual([]);
      const line = sentTexts(machine.botApi).find((text) => text.includes("Not read"));
      expect(line).toContain("models.vision");
    },
  );
});
