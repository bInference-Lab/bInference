import { idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { imagePartBytes, maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createMemoryOwnerImages } from "../fakes/memory-owner-images.js";
import { testAgent } from "../intents/test-intents.js";
import type { EngineCall } from "../operations/engine-call.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import { createImageHandlers } from "./image-handlers.js";
import { createImageHold } from "./image-hold.js";
import { createRunningTurns } from "./running-turns.js";
import { testImageHeads, testPng } from "./test-images.js";

const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const photo = "tg:AgACAgIAAxkBAAIB";
// A PNG one byte over two parts: its first bytes name the format, the rest is filler.
const large = new Uint8Array(imagePartBytes * 2 + 1);
large.set(testPng);

const stored: AgentInboxMessage = {
  id: message,
  agentId: testAgent,
  sessionId: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  kind: "inbox/message",
  payload: {
    text: "What is this chart?",
    images: [photo, "tg:large", "tg:jpeg", "tg:text"],
    surface: "telegram",
  },
  createdAtMs: 1,
};

// A later message of the agent, with two more images.
const later: AgentInboxMessage = {
  ...stored,
  id: idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000003"),
  payload: { text: "And these?", images: ["tg:gone", "tg:huge"], surface: "telegram" },
};

function setUp(sourceImages = new Map<string, Uint8Array>()) {
  const reads: string[] = [];
  const images = createMemoryOwnerImages(sourceImages);
  const source = {
    read: async (image: string, options: { readonly signal: AbortSignal }) => {
      reads.push(image);
      return images.read(image, options);
    },
  };
  const clock = createManualClock(0);
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(testCallers.runtime.credential));
  const agentInbox = {
    get: async (id: string) => Promise.resolve([stored, later].find((each) => each.id === id)),
  };
  const handler = createImageHandlers({
    agentInbox,
    turns,
    hold: createImageHold({ source, clock }),
  })["inbox/readImage"];
  const read = async (
    args: Partial<EngineCall<"inbox/readImage">["args"]>,
    caller = testCallers.runtime,
  ) => handler(testCall({ agent: testAgent, message, image: photo, ...args }, caller));
  return { read, reads, clock };
}

describe("inbox/readImage", () => {
  it("answers an image of the agent's own message, its format read from its first bytes", async () => {
    const { read } = setUp(new Map([[photo, testPng]]));
    expect(await read({})).toStrictEqual({
      ok: true,
      value: {
        contentType: "image/png",
        bytes: testPng.byteLength,
        offset: 0,
        data: Buffer.from(testPng).toString("base64"),
      },
    });
  });

  it("answers a large image part by part, reading its source once", async () => {
    const { read, reads } = setUp(new Map([["tg:large", large]]));
    const first = await read({ image: "tg:large" });
    const second = await read({ image: "tg:large", offset: imagePartBytes });
    const last = await read({ image: "tg:large", offset: imagePartBytes * 2 });
    expect([first, second]).toMatchObject([
      { ok: true, value: { offset: 0, next: imagePartBytes } },
      { ok: true, value: { offset: imagePartBytes, next: imagePartBytes * 2 } },
    ]);
    expect(last).toStrictEqual({
      ok: true,
      value: {
        contentType: "image/png",
        bytes: large.byteLength,
        offset: imagePartBytes * 2,
        data: "AA==",
      },
    });
    expect(reads).toStrictEqual(["tg:large"]);
    await read({ image: "tg:large" });
    expect(reads).toStrictEqual(["tg:large", "tg:large"]);
  });

  it("reads the source again once the hold's 2 minutes are up", async () => {
    const { read, reads, clock } = setUp(new Map([["tg:large", large]]));
    await read({ image: "tg:large" });
    await clock.advance(120_000);
    await read({ image: "tg:large", offset: imagePartBytes });
    expect(reads).toStrictEqual(["tg:large", "tg:large"]);
  });

  it("refuses an image no message of the agent names", async () => {
    const { read, reads } = setUp(
      new Map([
        [photo, testPng],
        ["tg:other", testPng],
      ]),
    );
    expect(await read({ image: "tg:other" })).toStrictEqual({
      ok: false,
      error: "image.not_found",
    });
    expect(
      await read({ agent: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099") }),
    ).toStrictEqual({
      ok: false,
      error: "image.not_found",
    });
    expect(
      await read({ message: idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000002") }),
    ).toStrictEqual({
      ok: false,
      error: "image.not_found",
    });
    expect(reads).toStrictEqual([]);
  });

  it("refuses an image over 5 MiB, in no format it reads, or gone from its source", async () => {
    const { read } = setUp(
      new Map([
        ["tg:jpeg", testImageHeads.jpeg],
        ["tg:text", new TextEncoder().encode("not an image")],
        ["tg:huge", new Uint8Array(maxImageBytes + 1)],
      ]),
    );
    const asked = [
      { message: stored.id, image: "tg:jpeg" },
      { message: stored.id, image: "tg:text" },
      { message: later.id, image: "tg:gone" },
      { message: later.id, image: "tg:huge" },
    ] as const;
    const outcomes = await Promise.all(asked.map(async (args) => read(args)));
    expect(outcomes).toMatchObject([
      { ok: true, value: { contentType: "image/jpeg" } },
      { ok: false, error: "image.format" },
      { ok: false, error: "image.unreadable" },
      { ok: false, error: "image.too_large" },
    ]);
  });

  it("refuses an offset past the image, and every caller but the runtime", async () => {
    const { read } = setUp(new Map([[photo, testPng]]));
    expect(await read({ offset: testPng.byteLength })).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(await read({}, testCallers.cli)).toStrictEqual({ ok: false, error: "auth.scope" });
  });
});
