import { streamingHttpContract } from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { createWebHttp } from "./scenario-web.js";

describe("createWebHttp", () => {
  it.each(
    streamingHttpContract({
      create: async (answer) => ({
        http: createWebHttp(() => answer),
        url: "https://page.example.com/",
        close: async () => Promise.resolve(),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
