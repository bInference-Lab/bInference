import { describe, expect, it } from "vitest";
import { streamingHttpContract } from "../contracts/streaming-http-contract.js";
import { createRecordedHttp } from "./recorded-http.js";

describe("createRecordedHttp", () => {
  it.each(
    streamingHttpContract({
      create: async (answer) => ({
        http: createRecordedHttp([answer]),
        url: "https://models.example.test/v1/chat/completions",
        close: async () => Promise.resolve(),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a request past its last answer as unreachable", async () => {
    const http = createRecordedHttp([]);
    const request = {
      method: "POST",
      url: "https://a.test/",
      signal: AbortSignal.abort(),
    } as const;
    await expect(http.open({ ...request, signal: new AbortController().signal })).rejects.toThrow(
      expect.objectContaining({ code: "http.unreachable" }),
    );
    expect(http.requests).toHaveLength(1);
  });
});
