import { describe, expect, it } from "vitest";
import { streamingHttpContract } from "../contracts/streaming-http-contract.js";
import { createScriptedMcpServer } from "./scripted-mcp-server.js";

describe("createScriptedMcpServer", () => {
  // The contract posts `{}`, a message without a method, which `raw` answers under "".
  it.each(
    streamingHttpContract({
      create: async (answer) => ({
        http: createScriptedMcpServer({
          raw: { "": { status: answer.status, headers: answer.headers, pieces: answer.chunks } },
        }),
        url: "https://rates.example.com/mcp",
        close: async () => Promise.resolve(),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
