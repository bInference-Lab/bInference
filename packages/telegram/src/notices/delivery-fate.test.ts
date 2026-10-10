import { BinferenceError, type ErrorDetails } from "@binference/core";
import { describe, expect, it } from "vitest";
import { backoffAfter, deliveryFateOf } from "./delivery-fate.js";

function fault(code: `telegram.${string}`, details: ErrorDetails = {}): BinferenceError {
  return new BinferenceError({ code, message: "The Bot API failed.", details });
}

describe("the fate of a notice whose send failed", () => {
  it.each([
    [
      "a 429",
      fault("telegram.flood", { status: 429, retryAfterMs: 7_000 }),
      { kind: "retry", afterMs: 7_000 },
    ],
    ["a 403", fault("telegram.api_refused", { status: 403 }), { kind: "retry", afterMs: 25_000 }],
    ["a 502", fault("telegram.api_refused", { status: 502 }), { kind: "retry", afterMs: 25_000 }],
    [
      "a refused token",
      fault("telegram.bad_token", { status: 401 }),
      { kind: "retry", afterMs: 25_000 },
    ],
    [
      "no connection",
      fault("telegram.unreachable", { isUnsent: true }),
      { kind: "retry", afterMs: 25_000 },
    ],
    ["a 400", fault("telegram.api_refused", { status: 400 }), { kind: "failed" }],
    ["a lost answer", fault("telegram.unreachable", { isUnsent: false }), { kind: "unknown" }],
    ["a failed call", fault("telegram.api_failed"), { kind: "unknown" }],
    ["no fault it can name", undefined, { kind: "unknown" }],
  ] as const)("decides the fate of %s on the second attempt", (_name, failure, fate) => {
    expect(deliveryFateOf(failure, 2)).toStrictEqual(fate);
  });

  it("waits longer after each refused attempt, up to ten minutes", () => {
    expect([1, 2, 3, 4, 9].map(backoffAfter)).toStrictEqual([
      5_000, 25_000, 120_000, 600_000, 600_000,
    ]);
  });
});
