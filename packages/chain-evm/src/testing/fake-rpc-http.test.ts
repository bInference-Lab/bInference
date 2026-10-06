import { httpContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakeRpcHttp, fakeRpcNode } from "./fake-rpc-http.js";

const okUrl = "https://ok.invalid/";
const missingUrl = "https://missing.invalid/";
const live = (): AbortSignal => new AbortController().signal;

describe("fake rpc http", () => {
  it.each(
    httpContract({
      create: () => ({
        http: createFakeRpcHttp({
          [okUrl]: () => ({ status: 200, headers: {}, body: "ok" }),
          [missingUrl]: () => ({ status: 404, headers: {}, body: "" }),
        }),
        okUrl,
        missingUrl,
        unreachableUrl: "https://nothing.invalid/",
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("holds a request until its signal aborts", async () => {
    const http = createFakeRpcHttp({ [okUrl]: "hang" });
    const controller = new AbortController();
    const pending = http.request({ method: "GET", url: okUrl, signal: controller.signal });
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("answers json-rpc requests with their id and records them", async () => {
    const http = createFakeRpcHttp({
      [okUrl]: fakeRpcNode((request) => ({ result: request.method })),
    });
    const response = await http.request({
      method: "POST",
      url: okUrl,
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] }),
      signal: live(),
    });
    expect(JSON.parse(response.body)).toStrictEqual({
      jsonrpc: "2.0",
      id: 7,
      result: "eth_chainId",
    });
    expect(http.requests()).toHaveLength(1);
  });

  it("keeps the last 1,000 requests it received", async () => {
    const urls = Array.from({ length: 1_001 }, (_, index) => `${okUrl}?n=${String(index)}`);
    const routed = createFakeRpcHttp(
      Object.fromEntries(urls.map((url) => [url, () => ({ status: 200, headers: {}, body: "" })])),
    );
    await Promise.all(urls.map((url) => routed.request({ method: "GET", url, signal: live() })));
    expect(routed.requests()).toHaveLength(1_000);
    expect(routed.requests()[0]?.url).toBe(urls[1]);
  });

  it("sends a raw status and body when a node answers one", async () => {
    const http = createFakeRpcHttp({
      [okUrl]: fakeRpcNode(() => ({ status: 503, body: "busy" })),
    });
    const response = await http.request({
      method: "POST",
      url: okUrl,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: live(),
    });
    expect(response).toStrictEqual({ status: 503, headers: {}, body: "busy" });
  });
});
