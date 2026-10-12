import type { HostLookup } from "@binference/core";
import { describe, expect, it } from "vitest";
import { streamingHttpContract } from "../contracts/streaming-http-contract.js";
import { startStandInModelServer } from "../testing/stand-in-model-server.js";
import { createNodeStreamingHttp } from "./node-streaming-http.js";

const live = (): AbortSignal => new AbortController().signal;

// A name whose every lookup answers loopback, as a name rebound after a check would.
const rebindsToLoopback: HostLookup = (_hostname, _options, callback) => {
  callback(null, [{ address: "127.0.0.1", family: 4 }]);
};

describe("createNodeStreamingHttp", () => {
  it.each(
    streamingHttpContract({
      create: async (answer) => {
        const server = await startStandInModelServer([answer]);
        const http = createNodeStreamingHttp({ version: "1.2.3" });
        return {
          http,
          url: `${server.origin}/v1/chat/completions`,
          close: async () => {
            await http.close();
            await server.close();
          },
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("names binference as the user agent in place of the caller's", async () => {
    const server = await startStandInModelServer([{ status: 204, headers: {}, chunks: [] }]);
    const http = createNodeStreamingHttp({ version: "1.2.3" });
    try {
      const headers = { "User-Agent": "someone-else", "content-type": "application/json" };
      const url = `${server.origin}/v1/chat/completions`;
      await http.open({ method: "POST", url, headers, body: "{}", signal: live() });
      expect(server.requests[0]?.headers).toMatchObject({
        "user-agent": "binference/1.2.3",
        "content-type": "application/json",
      });
    } finally {
      await http.close();
      await server.close();
    }
  });

  it("answers a redirect as it came, without following it", async () => {
    const moved = { status: 307, headers: { location: "https://elsewhere.test/" }, chunks: [] };
    const server = await startStandInModelServer([moved]);
    const http = createNodeStreamingHttp({ version: "1.2.3" });
    try {
      const url = `${server.origin}/v1/chat/completions`;
      const answer = await http.open({ method: "POST", url, body: "{}", signal: live() });
      expect([answer.status, answer.headers["location"]]).toStrictEqual([
        307,
        "https://elsewhere.test/",
      ]);
    } finally {
      await http.close();
      await server.close();
    }
  });

  it("refuses a public-only request to a private address, by name or as it is", async () => {
    const server = await startStandInModelServer([{ status: 204, headers: {}, chunks: [] }]);
    const http = createNodeStreamingHttp({ version: "1.2.3", lookup: rebindsToLoopback });
    const port = new URL(server.origin).port;
    const request = { method: "GET", signal: live(), publicOnly: true } as const;
    try {
      await expect(
        http.open({ ...request, url: `http://rebind.example.com:${port}/` }),
      ).rejects.toThrow(expect.objectContaining({ code: "http.private_address" }));
      await expect(http.open({ ...request, url: `${server.origin}/` })).rejects.toThrow(
        expect.objectContaining({ code: "http.private_address" }),
      );
      expect(server.requests).toHaveLength(0);
    } finally {
      await http.close();
      await server.close();
    }
  });

  it("refuses a request no server answers", async () => {
    const http = createNodeStreamingHttp({ version: "1.2.3" });
    const request = { method: "POST", body: "{}", signal: live() } as const;
    const server = await startStandInModelServer([]);
    await server.close();
    await expect(http.open({ ...request, url: `${server.origin}/v1` })).rejects.toThrow(
      expect.objectContaining({ code: "http.unreachable" }),
    );
    await http.close();
  });
});
