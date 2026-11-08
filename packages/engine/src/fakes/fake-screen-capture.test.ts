import { describe, expect, it } from "vitest";
import { screenCaptureContract } from "../contracts/screen-capture-contract.js";
import { createFakeScreenCapture } from "./fake-screen-capture.js";

describe("the fake screen capture", () => {
  it.each(
    screenCaptureContract({
      machines: async () =>
        Promise.resolve({
          seeing: createFakeScreenCapture(),
          headless: createFakeScreenCapture({ refuse: "no_screen" }),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
