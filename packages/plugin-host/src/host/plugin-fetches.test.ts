import type { Http, HttpRequest } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { FetchRequestWire } from "../channel/channel-message.schema.js";
import { createPluginFetches, fetchTimeoutMs, maxOpenFetches } from "./plugin-fetches.js";

const answer = { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
const index = "https://api.example.com/index";
const get = (url: string, more: Partial<FetchRequestWire> = {}): FetchRequestWire => ({
  url,
  method: "GET",
  headers: {},
  ...more,
});

function fetchesOver(http: Http) {
  const refused: string[] = [];
  const clock = createManualClock();
  const fetches = createPluginFetches({
    http,
    clock,
    hosts: ["api.example.com"],
    onRefused: (host) => refused.push(host),
  });
  return { fetches, refused, clock };
}

// An Http that never answers until its request's signal aborts, and counts what it was asked.
function silentHttp(): Http & { readonly asked: HttpRequest[] } {
  const asked: HttpRequest[] = [];
  return {
    asked,
    request: async (request) => {
      asked.push(request);
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  };
}

const signal = AbortSignal.timeout(10_000);

describe("createPluginFetches", () => {
  it("fetches a declared host over https, to public addresses only", async () => {
    const http = createScriptedHttp([{ method: "GET", url: index, response: answer }]);
    const { fetches } = fetchesOver(http);

    await expect(fetches.fetch("f1", get(index), signal)).resolves.toStrictEqual({
      kind: "fetched",
      id: "f1",
      ...answer,
    });
    expect(http.requests()).toMatchObject([{ url: index, publicOnly: true }]);
  });

  it.each([
    ["another host", "https://other.example.net/", "other.example.net"],
    ["a declared host over http", "http://api.example.com/index", "api.example.com"],
    ["a declared host on another port", "https://api.example.com:8443/", "api.example.com"],
    ["a subdomain of a declared host", "https://x.api.example.com/", "x.api.example.com"],
  ])("refuses %s and names it", async (_name, url, host) => {
    const http = createScriptedHttp([]);
    const { fetches, refused } = fetchesOver(http);

    await expect(fetches.fetch("f1", get(url), signal)).resolves.toStrictEqual({
      kind: "fetchRefused",
      id: "f1",
      refused: "host_refused",
    });
    expect(refused).toStrictEqual([host]);
    expect(http.requests()).toStrictEqual([]);
  });

  it.each([
    ["a private address", get("https://127.0.0.1/")],
    ["a URL with a password", get("https://user:pass@api.example.com/")],
    ["a host header", get(index, { headers: { Host: "other.example.net" } })],
    ["a proxy header", get(index, { headers: { "Proxy-Authorization": "x" } })],
    ["a header with a line break", get(index, { headers: { "x-a": "1\r\nhost: b" } })],
    ["a body on a GET", get(index, { body: "x" })],
  ])("refuses %s as a bad request, sending nothing", async (_name, request) => {
    const http = createScriptedHttp([]);
    const { fetches, refused } = fetchesOver(http);

    await expect(fetches.fetch("f1", request, signal)).resolves.toMatchObject({
      kind: "fetchRefused",
    });
    expect(refused).toStrictEqual([]);
    expect(http.requests()).toStrictEqual([]);
  });

  it("keeps 8 fetches open at most and ends one after 15 seconds", async () => {
    const http = silentHttp();
    const { fetches, clock } = fetchesOver(http);
    const open = Array.from({ length: maxOpenFetches }, async (_, at) =>
      fetches.fetch(`f${String(at)}`, get(index), signal),
    );
    const ninth = await fetches.fetch("f9", get(index), signal);
    await clock.advance(fetchTimeoutMs);

    expect(ninth).toStrictEqual({ kind: "fetchRefused", id: "f9", refused: "busy" });
    await expect(open[0]).resolves.toStrictEqual({
      kind: "fetchRefused",
      id: "f0",
      refused: "timeout",
    });
    expect(http.asked).toHaveLength(maxOpenFetches);
  });

  it("refuses an answer too large for one message", async () => {
    const large = { ...answer, body: "x".repeat(1_048_576) };
    const { fetches } = fetchesOver(
      createScriptedHttp([{ method: "GET", url: index, response: large }]),
    );

    await expect(fetches.fetch("f1", get(index), signal)).resolves.toStrictEqual({
      kind: "fetchRefused",
      id: "f1",
      refused: "too_large",
    });
  });
});
