import { describe, expect, it } from "vitest";
import { ids } from "../examples/wire-values.js";
import { httpOperations, httpRequestLimits } from "./http-operations.schema.js";

const args = httpOperations["http/request"].args;
const base = { agent: ids.agent, method: "GET", url: "https://api.example.com/v1/price" };

const parses = (extra: object): boolean => args.safeParse({ ...base, ...extra }).success;

describe("an API request's args", () => {
  it("takes a request with headers, a body and a time limit", () => {
    const headers = [{ name: "Authorization", value: "Bearer {{credential:API_KEY}}" }];
    expect(parses({ method: "POST", headers, body: "{}", timeoutSeconds: 25 })).toBe(true);
    expect(parses({})).toBe(true);
  });

  it.each([
    ["a header binference sets", { headers: [{ name: "Host", value: "evil.example" }] }],
    ["its own user agent", { headers: [{ name: "user-agent", value: "curl/8" }] }],
    ["a name that is no token", { headers: [{ name: "X Key", value: "1" }] }],
    ["a value with a line break", { headers: [{ name: "X-Key", value: "a\r\nHost: b" }] }],
    [
      "a header named twice",
      {
        headers: [
          { name: "X-Key", value: "1" },
          { name: "x-key", value: "2" },
        ],
      },
    ],
    ["a body with GET", { body: "{}" }],
    ["a body with HEAD", { method: "HEAD", body: "{}" }],
    ["a time limit past 25 seconds", { timeoutSeconds: 26 }],
    ["a method it does not send", { method: "TRACE" }],
  ] as const)("refuses %s", (_name, extra) => {
    expect(parses(extra)).toBe(false);
  });

  it("refuses more than 32 headers and a body past 256 KiB", () => {
    const headers = Array.from({ length: httpRequestLimits.headers + 1 }, (_, index) => ({
      name: `X-${String(index)}`,
      value: "1",
    }));
    expect(parses({ headers })).toBe(false);
    expect(parses({ method: "POST", body: "a".repeat(httpRequestLimits.bodyBytes) })).toBe(true);
    expect(parses({ method: "POST", body: "a".repeat(httpRequestLimits.bodyBytes + 1) })).toBe(
      false,
    );
  });
});
