import { describe, expect, it } from "vitest";
import { createOriginCheck } from "./origin-check.js";

describe("createOriginCheck", () => {
  const isAllowed = createOriginCheck({
    port: 7456,
    extraOrigins: ["https://box.tail1234.ts.net", "not a url"],
  });

  it.each([
    "http://127.0.0.1:7456",
    "http://localhost:7456",
    "HTTP://LOCALHOST:7456",
    "https://box.tail1234.ts.net",
    "https://box.tail1234.ts.net:443",
  ])("lets %s connect", (origin) => {
    expect(isAllowed(origin)).toBe(true);
  });

  it.each([
    ["no origin", undefined],
    ["another port", "http://127.0.0.1:7457"],
    ["https on the loopback port", "https://127.0.0.1:7456"],
    ["another site", "https://evil.example"],
    ["an opaque origin", "null"],
    ["text that is no URL", "not a url"],
  ])("refuses %s", (_name, origin) => {
    expect(isAllowed(origin)).toBe(false);
  });
});
