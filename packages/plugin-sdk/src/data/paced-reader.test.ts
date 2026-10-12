import type { HttpResponse } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createPacedReader, pathSegment, pauseOf } from "./paced-reader.js";

const startMs = Date.UTC(2026, 9, 12, 6, 0, 0);
const origin = "https://api.example.invalid";
const live = (): AbortSignal => new AbortController().signal;

function answer(body: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { "content-type": "application/json", ...headers }, body };
}

const service = {
  id: "example",
  name: "Example",
  origin,
  headers: { accept: "application/json;version=1" },
  limits: { all: { max: 2, windowMs: 60_000 } },
} as const;

// The read of `/items`, whose one documented answer is an empty list.
const items = (notFound?: readonly string[]) => ({
  group: "all" as const,
  path: "/items",
  reader: (text: string) => (text === "[]" ? ([] as readonly string[]) : undefined),
  ...(notFound === undefined ? {} : { notFound }),
});

const tooMany = (headers: Record<string, string> = {}) => answer("", 429, headers);

function readerOver(response: HttpResponse) {
  const http = createScriptedHttp([{ method: "GET", url: `${origin}/items`, response }]);
  const clock = createManualClock(startMs);
  return { http, read: createPacedReader({ http, clock, service, maxWaitMs: 10_000 }) };
}

describe("the paced reader", () => {
  it("sends the service's headers with every request", async () => {
    const { http, read } = readerOver(answer("[]"));
    await expect(read(items(), live())).resolves.toStrictEqual([]);
    expect(http.requests()[0]?.headers).toStrictEqual(service.headers);
  });

  it("answers a 404 with the read's meaning of it, and fails one without", async () => {
    const { read } = readerOver(answer('{"errors":[]}', 404));
    await expect(read(items([]), live())).resolves.toStrictEqual([]);
    await expect(read(items(), live())).rejects.toMatchObject({
      code: "example.unavailable",
      retryable: false,
      details: { status: 404 },
    });
  });

  it("fails a third read in the window at once when its turn is past the longest wait", async () => {
    const { http, read } = readerOver(answer("[]"));
    await read(items(), live());
    await read(items(), live());
    await expect(read(items(), live())).rejects.toMatchObject({
      code: "example.rate_limited",
      details: { retryAfterMs: 60_000 },
    });
    expect(http.requests()).toHaveLength(2);
  });

  it("names the service in a bad answer", async () => {
    const { read } = readerOver(answer("{}"));
    await expect(read(items(), live())).rejects.toMatchObject({
      code: "example.bad_answer",
      message: "Example's answer to /items is outside its documented shape.",
    });
  });

  it("reads a pause from Retry-After, else the default, never longer than five minutes", () => {
    const date = new Date(startMs + 5_000).toUTCString();
    expect([
      pauseOf(tooMany({ "retry-after": "7" }), startMs, 60_000),
      pauseOf(tooMany({ "retry-after": date }), startMs, 60_000),
      pauseOf(tooMany({ "retry-after": "86400" }), startMs, 60_000),
      pauseOf(tooMany({ "retry-after": "soon" }), startMs, 60_000),
      pauseOf(tooMany(), startMs, 30_000),
    ]).toStrictEqual([7_000, 5_000, 300_000, 60_000, 30_000]);
  });

  it("lets only ids and addresses into a path", () => {
    expect(pathSegment("example", "0xAbC_1.2:3-4")).toBe("0xAbC_1.2:3-4");
    expect(() => pathSegment("example", "../x")).toThrow(
      expect.objectContaining({ code: "example.bad_request" }),
    );
    expect(() => pathSegment("example", "")).toThrow(
      expect.objectContaining({ code: "example.bad_request" }),
    );
  });
});
