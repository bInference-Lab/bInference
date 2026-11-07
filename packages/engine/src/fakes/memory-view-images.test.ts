import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { viewImageSourceContract } from "../contracts/view-image-source-contract.js";
import { createMemoryViewImages } from "./memory-view-images.js";

describe("the in-memory viewed images", () => {
  it.each(
    viewImageSourceContract({
      create: async () =>
        Promise.resolve({
          source: createMemoryViewImages(new Map([["https://example.com/chart.png", testPng]])),
          held: { place: { url: "https://example.com/chart.png" }, bytes: testPng },
          missing: { path: "~/pictures/none.png" },
          walled: { path: "/state/keys/agent-key" },
          private: { url: "http://router.private.invalid/cam.png" },
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
