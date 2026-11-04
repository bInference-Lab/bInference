import { createSecret, type HostLookup, outboundRouteOf, directRoute } from "@binference/core";
import { startStandInProxy } from "@binference/platform/testing";
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
        const http = createNodeStreamingHttp({ version: "1.2.3", route: directRoute });
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
    const http = createNodeStreamingHttp({ version: "1.2.3", route: directRoute });
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
    const http = createNodeStreamingHttp({ version: "1.2.3", route: directRoute });
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
    const http = createNodeStreamingHttp({
      version: "1.2.3",
      lookup: rebindsToLoopback,
      route: directRoute,
    });
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
    const http = createNodeStreamingHttp({ version: "1.2.3", route: directRoute });
    const request = { method: "POST", body: "{}", signal: live() } as const;
    const server = await startStandInModelServer([]);
    await server.close();
    await expect(http.open({ ...request, url: `${server.origin}/v1` })).rejects.toThrow(
      expect.objectContaining({ code: "http.unreachable" }),
    );
    await http.close();
  });

  it("sends a model call through the proxy of the route in force, then directly again", async () => {
    const server = await startStandInModelServer([{ status: 204, headers: {}, chunks: [] }]);
    const proxy = await startStandInProxy({
      toPort: Number(new URL(server.origin).port),
      credentials: "owner:pass",
    });
    // The provider's name resolves here to the loopback server: only a direct call reaches it.
    const http = createNodeStreamingHttp({
      version: "1.2.3",
      lookup: rebindsToLoopback,
      route: directRoute,
    });
    const url = proxy.url.replace("http://", "http://owner:pass@");
    const named = `http://models.example.test:${new URL(server.origin).port}/v1`;
    const request = { method: "POST", body: "{}", signal: live() } as const;
    try {
      http.use(outboundRouteOf({ proxy: createSecret(url), noProxy: [] }));
      const answer = await http.open({ ...request, url: "http://models.example.test/v1" });
      expect(answer.status).toBe(204);
      expect(proxy.tunnels).toStrictEqual(["models.example.test:80"]);
      http.use(outboundRouteOf({ proxy: "unread", noProxy: [] }));
      await expect(http.open({ ...request, url: "http://models.example.test/v1" })).rejects.toThrow(
        expect.objectContaining({ code: "http.proxy_unusable" }),
      );
      http.use(outboundRouteOf({ noProxy: [] }));
      await http.open({ ...request, url: named });
      expect(proxy.tunnels).toHaveLength(1);
      expect(server.requests).toHaveLength(2);
    } finally {
      await http.close();
      await proxy.close();
      await server.close();
    }
  });

  it("refuses every request until the settings put a route in force", async () => {
    const http = createNodeStreamingHttp({ version: "1.2.3" });
    try {
      await expect(
        http.open({ method: "POST", url: "http://127.0.0.1:9/v1", body: "{}", signal: live() }),
      ).rejects.toThrow(expect.objectContaining({ code: "http.no_route" }));
    } finally {
      await http.close();
    }
  });
});
