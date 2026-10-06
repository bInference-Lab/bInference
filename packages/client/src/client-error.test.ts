import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { errorFromBye, errorFromFail } from "./client-error.js";

describe("errorFromFail", () => {
  it("keeps the engine's code, message, retry flag and details", () => {
    const error = errorFromFail({
      code: "quote.venue_down",
      message: "No venue answered.",
      retryable: true,
      details: { venues: 3 },
    });
    expect(error).toBeInstanceOf(BinferenceError);
    expect(error).toMatchObject({
      code: "quote.venue_down",
      message: "No venue answered.",
      retryable: true,
      details: { venues: 3 },
    });
  });

  it("gives an error without details empty details", () => {
    const error = errorFromFail({ code: "agent.frozen", message: "Frozen.", retryable: false });
    expect(error.details).toStrictEqual({});
  });
});

describe("errorFromBye", () => {
  it.each([
    ["auth.revoked", false],
    ["protocol.version", false],
    ["engine.stopping", true],
    ["internal.error", true],
  ] as const)("marks a bye with %s as retryable: %s", (code, retryable) => {
    expect(errorFromBye({ t: "bye", code, message: "Bye." })).toMatchObject({ code, retryable });
  });
});
