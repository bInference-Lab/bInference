import { describe, expect, it } from "vitest";
import { ownerImageReaderContract } from "../contracts/owner-image-reader-contract.js";
import { nthTestId } from "./memory-agent-stores.js";
import { createMemoryImageReader } from "./memory-image-reader.js";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("the in-memory image reader", () => {
  it.each(
    ownerImageReaderContract({
      create: async () =>
        Promise.resolve({
          reader: createMemoryImageReader(
            new Map([["tg:chart", { contentType: "image/png", bytes: png }]]),
            new Map([["tg:poster", "too_large"]]),
          ),
          agent: nthTestId("agt", 1),
          message: nthTestId("msg", 1),
          held: { image: "tg:chart", contentType: "image/png", bytes: png },
          large: "tg:poster",
          unnamed: "tg:other",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
