import { err, idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { imagePartBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createMemoryViewImages } from "../fakes/memory-view-images.js";
import { testAgent } from "../intents/test-intents.js";
import type { EngineCall } from "../operations/engine-call.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createRunningTurns } from "./running-turns.js";
import { testPng } from "./test-images.js";
import { createViewImageHandlers } from "./view-image-handlers.js";

const chart = "https://example.com/chart.png";
// A PNG one byte over two parts: its first bytes name the format, the rest is filler.
const large = new Uint8Array(imagePartBytes * 2 + 1);
large.set(testPng);
const text = new TextEncoder().encode("not an image at all");

function setUp() {
  const reads: string[] = [];
  const images = createMemoryViewImages(
    new Map([
      [chart, testPng],
      ["~/pictures/big.png", large],
      ["~/pictures/notes.txt", text],
    ]),
  );
  const source = {
    read: async (
      place: Parameters<typeof images.read>[0],
      options: { readonly signal: AbortSignal },
    ) => {
      reads.push("url" in place ? place.url : place.path);
      return images.read(place, options);
    },
  };
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(testCallers.runtime.credential));
  const handler = createViewImageHandlers({ turns, source, clock: createManualClock(0) })[
    "image/view"
  ];
  const view = async (
    args: Partial<EngineCall<"image/view">["args"]>,
    caller = testCallers.runtime,
  ) => handler(testCall({ agent: testAgent, ...args }, caller));
  return { view, reads };
}

describe("image/view", () => {
  it("answers an image at a public address, its format read from its first bytes", async () => {
    const { view } = setUp();
    expect(await view({ url: chart })).toStrictEqual({
      ok: true,
      value: {
        contentType: "image/png",
        bytes: testPng.byteLength,
        offset: 0,
        data: Buffer.from(testPng).toString("base64"),
      },
    });
  });

  it("answers a large file part by part, reading it once", async () => {
    const { view, reads } = setUp();
    const path = "~/pictures/big.png";
    const parts = [
      await view({ path }),
      await view({ path, offset: imagePartBytes }),
      await view({ path, offset: imagePartBytes * 2 }),
    ];
    expect(parts).toMatchObject([
      { ok: true, value: { offset: 0, next: imagePartBytes } },
      { ok: true, value: { offset: imagePartBytes, next: imagePartBytes * 2 } },
      { ok: true, value: { offset: imagePartBytes * 2 } },
    ]);
    expect(reads).toStrictEqual([path]);
  });

  it("refuses binference's folder, a private address, a missing file and a non-image", async () => {
    const { view } = setUp();
    const answers = await Promise.all([
      view({ path: "/state/keys/agent-key" }),
      view({ url: "http://router.private.invalid/cam.png" }),
      view({ path: "~/pictures/gone.png" }),
      view({ path: "~/pictures/notes.txt" }),
    ]);
    expect(answers).toStrictEqual([
      err("image.walled"),
      err("image.not_public"),
      err("image.not_found"),
      err("image.format"),
    ]);
  });

  it("answers only the runtime the engine runs now", async () => {
    const { view } = setUp();
    expect(await view({ url: chart }, testCallers.cli)).toStrictEqual(err("auth.scope"));
  });
});
