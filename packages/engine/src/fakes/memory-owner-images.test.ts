import { maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { ownerImageSourceContract } from "../contracts/owner-image-source-contract.js";
import { createMemoryOwnerImages } from "./memory-owner-images.js";

describe("the in-memory owner images", () => {
  it.each(
    ownerImageSourceContract({
      create: async () =>
        Promise.resolve({
          source: createMemoryOwnerImages(
            new Map([
              ["upl_chart", testPng],
              ["upl_poster", new Uint8Array(maxImageBytes + 1)],
            ]),
          ),
          held: { image: "upl_chart", bytes: testPng },
          large: "upl_poster",
          gone: "upl_gone",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
