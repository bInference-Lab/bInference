import { isErrorCode } from "@binference/core";
import { describe, expect, it } from "vitest";
import { protocolErrorCodes } from "./protocol-error-codes.js";
import { protocolErrorSchema } from "./protocol-error.js";

describe("protocolErrorCodes", () => {
  it("holds dotted codes, each once", () => {
    expect(protocolErrorCodes.filter((code) => !isErrorCode(code))).toStrictEqual([]);
    expect(new Set(protocolErrorCodes).size).toBe(protocolErrorCodes.length);
  });

  it("covers every area of the spec's error table", () => {
    const areas = new Set(protocolErrorCodes.map((code) => code.split(".")[0]));
    expect([...areas]).toStrictEqual([
      "protocol",
      "auth",
      "engine",
      "runtime",
      "agent",
      "wallet",
      "intent",
      "order",
      "asset",
      "name",
      "quote",
      "chain",
      "limit",
      "config",
      "plugin",
      "job",
      "internal",
    ]);
  });
});

describe("protocolErrorSchema", () => {
  const error = { code: "internal.error", message: "Unexpected.", retryable: false } as const;

  it.each([
    ["without details", error],
    ["with ids and counts in its details", { ...error, details: { ref: "log-17", tries: 2 } }],
    ["with a code a newer engine added", { ...error, code: "wallet.paused" }],
  ] as const)("parses an error %s", (_name, value) => {
    expect(protocolErrorSchema.parse(value)).toStrictEqual(value);
  });

  it.each([
    ["a code without an area", { ...error, code: "error" }],
    ["no retry flag", { code: "internal.error", message: "Unexpected." }],
    ["a nested detail", { ...error, details: { ref: { line: 17 } } }],
  ] as const)("refuses an error with %s", (_name, value) => {
    expect(protocolErrorSchema.safeParse(value).success).toBe(false);
  });
});
