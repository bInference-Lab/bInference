import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testImageHeads, testPng } from "../chat/test-images.js";
import { ownerImageSourceContract } from "../contracts/owner-image-source-contract.js";
import { expectOk } from "../intents/test-intents.js";
import { createUploadShelf } from "./upload-shelf.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const png = { contentType: "image/png", bytes: testPng.byteLength } as const;

function shelfAt(startMs = 0) {
  const clock = createManualClock(startMs);
  return { clock, shelf: createUploadShelf({ clock, random: createSeededRandom(7) }) };
}

// A shelf holding the test PNG, and the upload id it gave it.
function holding(): {
  readonly shelf: ReturnType<typeof createUploadShelf>;
  readonly upload: string;
} {
  const { shelf } = shelfAt();
  return { shelf, upload: expectOk(shelf.receive(shelf.ticket(png).ticket, testPng)) };
}

describe("the upload shelf", () => {
  it.each(
    ownerImageSourceContract({
      create: async () => {
        const { shelf, upload } = holding();
        return Promise.resolve({
          source: shelf,
          held: { image: upload, bytes: testPng },
          gone: "upl_gone",
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("takes one body per ticket, within 2 minutes", async () => {
    const { shelf, clock } = shelfAt();
    const first = shelf.ticket(png);
    expect(first.expiresAt).toBe(120_000);
    expect(shelf.receive(first.ticket, testPng)).toMatchObject({ ok: true });
    expect(shelf.receive(first.ticket, testPng)).toStrictEqual({ ok: false, error: "ticket" });
    const late = shelf.ticket(png);
    await clock.advance(120_000);
    expect(shelf.receive(late.ticket, testPng)).toStrictEqual({ ok: false, error: "ticket" });
  });

  it("refuses a body over the plan or 5 MiB, of another size, or of another format", () => {
    const { shelf } = shelfAt();
    const big = { contentType: "image/png", bytes: maxImageBytes } as const;
    const outcomes = [
      shelf.receive(shelf.ticket(big).ticket, new Uint8Array(maxImageBytes + 1)),
      shelf.receive(shelf.ticket({ ...png, bytes: 10 }).ticket, testPng),
      shelf.receive(shelf.ticket(png).ticket, testPng.subarray(0, 20)),
      shelf.receive(shelf.ticket({ ...png, bytes: 6 }).ticket, testImageHeads.jpeg),
    ];
    expect(outcomes).toStrictEqual([
      { ok: false, error: "too_large" },
      { ok: false, error: "too_large" },
      { ok: false, error: "length" },
      { ok: false, error: "format" },
    ]);
  });

  it("keeps an upload 1 hour, and at most 16 at once, the oldest dropped first", async () => {
    const { shelf, clock } = shelfAt();
    const upload = () => expectOk(shelf.receive(shelf.ticket(png).ticket, testPng));
    const first = upload();
    const second = upload();
    Array.from({ length: 15 }, upload);
    expect(await shelf.read(first, live())).toStrictEqual({ ok: false, error: "unreadable" });
    expect(await shelf.read(second, live())).toMatchObject({ ok: true });
    await clock.advance(3_600_000);
    expect(await shelf.read(second, live())).toStrictEqual({ ok: false, error: "unreadable" });
  });
});
