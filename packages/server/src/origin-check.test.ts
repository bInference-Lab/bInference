import { describe, expect, it } from "vitest";
import { createOriginRules } from "./origin-check.js";

describe("createOriginRules", () => {
  const rules = createOriginRules({
    port: 7456,
    extraOrigins: ["https://box.tail1234.ts.net", "not a url"],
    publicOrigin: "https://owner.example.ts.net",
  });

  it.each([
    "http://127.0.0.1:7456",
    "http://localhost:7456",
    "HTTP://LOCALHOST:7456",
    "https://box.tail1234.ts.net",
    "https://box.tail1234.ts.net:443",
  ])("lets %s connect and pair", (origin) => {
    expect([rules.isSocketOrigin(origin), rules.isPairingOrigin(origin)]).toStrictEqual([
      true,
      true,
    ]);
  });

  it("lets the public origin connect, but never pair", () => {
    const origin = "https://owner.example.ts.net";
    expect([rules.isSocketOrigin(origin), rules.isPairingOrigin(origin)]).toStrictEqual([
      true,
      false,
    ]);
  });

  it.each([
    ["no origin", undefined],
    ["another port", "http://127.0.0.1:7457"],
    ["https on the loopback port", "https://127.0.0.1:7456"],
    ["another site", "https://evil.example"],
    ["an opaque origin", "null"],
    ["text that is no URL", "not a url"],
  ])("refuses %s", (_name, origin) => {
    expect([rules.isSocketOrigin(origin), rules.isPairingOrigin(origin)]).toStrictEqual([
      false,
      false,
    ]);
  });

  it.each([
    ["the public host", { host: "owner.example.ts.net" }],
    ["the public host with a port", { host: "OWNER.example.ts.net:443" }],
    ["a forwarded public host", { host: "127.0.0.1:7456", forwardedHost: "owner.example.ts.net" }],
    ["the public origin", { host: "127.0.0.1:7456", origin: "https://owner.example.ts.net" }],
  ])("knows a request through %s came through the public address", (_name, names) => {
    expect(rules.isPublished(names)).toBe(true);
  });

  it("takes a loopback request as local, and nothing as published without a public origin", () => {
    const local = createOriginRules({ port: 7456, extraOrigins: [] });
    expect([
      rules.isPublished({ host: "127.0.0.1:7456", origin: "http://127.0.0.1:7456" }),
      local.isPublished({ host: "owner.example.ts.net" }),
    ]).toStrictEqual([false, false]);
  });
});
