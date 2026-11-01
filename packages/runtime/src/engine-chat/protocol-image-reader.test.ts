import { BinferenceError } from "@binference/core";
import { imagePartBytes, maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { ownerImageReaderContract } from "../contracts/owner-image-reader-contract.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { type ImageClient, createProtocolImageReader } from "./protocol-image-reader.js";

const agent = nthTestId("agt", 1);
const message = nthTestId("msg", 1);
// A PNG's signature, then filler: two full parts and one byte more.
const chart = new Uint8Array(imagePartBytes * 2 + 1);
chart.set([0x89, 0x50, 0x4e, 0x47]);

interface Served {
  readonly bytes: Uint8Array;
  /** Shifts every part's offset, as an engine that answers out of order. */
  readonly skew?: number;
}

// The engine's `inbox/readImage` over the images it holds: each part 512 KiB from `offset`, a
// refusal as a `fail` with its code.
function clientOver(
  images: ReadonlyMap<string, Served | string>,
  calls: number[] = [],
): ImageClient {
  return {
    call: async (_op: string, args: { image: string; offset?: number; message: string }) => {
      const offset = args.offset ?? 0;
      calls.push(offset);
      const served = args.message === message ? images.get(args.image) : "image.not_found";
      if (served === undefined || typeof served === "string") {
        const code = (served ?? "image.not_found") as `${string}.${string}`;
        throw new BinferenceError({ code, message: "refused" });
      }
      const end = Math.min(served.bytes.byteLength, offset + imagePartBytes);
      return Promise.resolve({
        contentType: "image/png",
        bytes: served.bytes.byteLength,
        offset: offset + (served.skew ?? 0),
        data: Buffer.from(served.bytes.subarray(offset, end)).toString("base64"),
        ...(end < served.bytes.byteLength ? { next: end } : {}),
      });
    },
  } as ImageClient;
}

const live = (): AbortSignal => new AbortController().signal;

describe("createProtocolImageReader", () => {
  it.each(
    ownerImageReaderContract({
      create: async () =>
        Promise.resolve({
          reader: createProtocolImageReader(
            clientOver(
              new Map<string, Served | string>([
                ["tg:chart", { bytes: chart }],
                ["tg:poster", "image.too_large"],
              ]),
            ),
          ),
          agent,
          message,
          held: { image: "tg:chart", contentType: "image/png", bytes: chart },
          large: "tg:poster",
          unnamed: "tg:other",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads each part from where the one before said the next one starts", async () => {
    const calls: number[] = [];
    const reader = createProtocolImageReader(
      clientOver(new Map([["tg:chart", { bytes: chart }]]), calls),
    );
    await reader.read({ agent, message, image: "tg:chart" }, live());
    expect(calls).toStrictEqual([0, imagePartBytes, imagePartBytes * 2]);
  });

  it("answers Telegram out of reach as unreadable, and a part out of order too", async () => {
    const reader = createProtocolImageReader(
      clientOver(
        new Map<string, Served | string>([
          ["tg:away", "telegram.unreachable"],
          ["tg:skewed", { bytes: chart, skew: 1 }],
        ]),
      ),
    );
    const read = async (image: string) => reader.read({ agent, message, image }, live());
    expect([await read("tg:away"), await read("tg:skewed")]).toStrictEqual([
      { ok: false, error: "unreadable" },
      { ok: false, error: "unreadable" },
    ]);
  });

  it("refuses an image the engine says is over 5 MiB, and rejects an engine fault", async () => {
    const huge = { bytes: new Uint8Array(maxImageBytes + 1) };
    const reader = createProtocolImageReader(
      clientOver(
        new Map<string, Served | string>([
          ["tg:huge", huge],
          ["tg:down", "engine.timeout"],
        ]),
      ),
    );
    expect(await reader.read({ agent, message, image: "tg:huge" }, live())).toStrictEqual({
      ok: false,
      error: "too_large",
    });
    await expect(reader.read({ agent, message, image: "tg:down" }, live())).rejects.toMatchObject({
      code: "engine.timeout",
    });
  });
});
