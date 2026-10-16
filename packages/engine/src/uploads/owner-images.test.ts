import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { ownerImageSourceContract } from "../contracts/owner-image-source-contract.js";
import { createMemoryOwnerImages } from "../fakes/memory-owner-images.js";
import { expectOk } from "../intents/test-intents.js";
import { ownerImagesOf } from "./owner-images.js";
import { createUploadShelf } from "./upload-shelf.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const holder = "tg:279058397";

// A shelf holding the test PNG, and the upload id it gave it.
function holding() {
  const shelf = createUploadShelf({ clock: createManualClock(0), random: createSeededRandom(7) });
  const plan = { contentType: "image/png", bytes: testPng.byteLength } as const;
  return { shelf, upload: expectOk(shelf.receive(shelf.ticket(plan, holder).ticket, testPng)) };
}

describe("ownerImagesOf", () => {
  const bot = createMemoryOwnerImages(
    new Map([
      ["tg:chart", testPng],
      ["tg:poster", new Uint8Array(maxImageBytes + 1)],
    ]),
  );
  it.each(
    ownerImageSourceContract({
      create: async () => {
        const { shelf, upload } = holding();
        return Promise.resolve({
          source: ownerImagesOf({ bot, uploads: shelf }),
          held: { image: upload, bytes: testPng },
          large: "tg:poster",
          gone: "tg:gone",
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a bot photo from the bot, and none without a bot", async () => {
    const { shelf } = holding();
    expect(await ownerImagesOf({ bot, uploads: shelf }).read("tg:chart", live())).toStrictEqual({
      ok: true,
      value: testPng,
    });
    expect(await ownerImagesOf({ uploads: shelf }).read("tg:chart", live())).toStrictEqual({
      ok: false,
      error: "unreadable",
    });
  });
});
