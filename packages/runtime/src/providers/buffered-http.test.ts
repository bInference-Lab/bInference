import { describe, expect, it } from "vitest";
import { streamingHttpContract } from "../contracts/streaming-http-contract.js";
import { createBufferedHttp } from "./buffered-http.js";

describe("createBufferedHttp", () => {
  it.each(
    streamingHttpContract({
      create: async (answer) => ({
        http: createBufferedHttp({
          request: async () => ({
            status: answer.status,
            headers: answer.headers,
            body: answer.chunks.join(""),
          }),
        }),
        url: "https://models.example.test/v1/chat/completions",
        close: async () => Promise.resolve(),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
