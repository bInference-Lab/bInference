import { idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { createUploadShelf } from "./upload-shelf.js";

// The ticket is held for the caller's credential, which the public address checks.
const isCaller = (holder: string): boolean => holder === testCallers.cli.credential;

describe("an upload of the owner's image", () => {
  it("goes from upload/start through the shelf to the runtime's inbox/readImage", async () => {
    const uploads = createUploadShelf({
      clock: createManualClock(0),
      random: createSeededRandom(3),
    });
    const test = await startTestEngine({ uploads });
    const { handlers } = test.engine;
    const plan = { contentType: "image/png", bytes: testPng.byteLength } as const;
    const started = expectOk(await handlers["upload/start"](testCall(plan)));
    expect(started.url).toMatch(/^\/upload\/[\w-]{43}$/);
    expect(started.expiresAt).toBe(120_000);
    const image = expectOk(
      uploads.receive(started.url.slice("/upload/".length), testPng, isCaller),
    );
    await handlers["chat/post"](
      testCall({ agent: testAgent, text: "This chart", images: [image] }),
    );
    const listed = expectOk(await handlers["inbox/list"](testCall({}, testCallers.runtime))).items;
    const message = idSchema("msg").parse(listed[0]?.message);
    const read = await handlers["inbox/readImage"](
      testCall({ agent: testAgent, message, image }, testCallers.runtime),
    );
    expect(read).toStrictEqual({
      ok: true,
      value: {
        contentType: "image/png",
        bytes: testPng.byteLength,
        offset: 0,
        data: Buffer.from(testPng).toString("base64"),
      },
    });
  });
});
