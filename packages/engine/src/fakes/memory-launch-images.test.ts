import { describe, expect, it } from "vitest";
import { ownerImageSourceContract } from "../contracts/owner-image-source-contract.js";
import { createMemoryLaunchImages } from "./memory-launch-images.js";

const bytes = new Uint8Array([137, 80, 78, 71]);

describe("the memory launch images", () => {
  it.each(
    ownerImageSourceContract({
      create: async () =>
        await Promise.resolve({
          source: createMemoryLaunchImages(new Map([["upl_a", bytes]])),
          held: { image: "upl_a", bytes },
          gone: "upl_b",
        }),
    }),
  )("follow the owner image source contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
