import { describe, expect, it } from "vitest";
import { type FailedAttempt, stepAfter } from "./attempt-policy.js";

const first: FailedAttempt = { failure: "transient", attempts: 1, retries: 0, committed: false };

describe("stepAfter", () => {
  it.each([
    ["the provider's Retry-After", { retryAfterMs: 7_000 }, 7_000],
    ["1 s without one", {}, 1_000],
    ["4 s before the second retry", { attempts: 2, retries: 1 }, 4_000],
    ["a Retry-After of exactly 60 s", { retryAfterMs: 60_000 }, 60_000],
  ])("tries a transient failure again after %s", (_case, said, waitMs) => {
    expect(stepAfter({ ...first, ...said })).toStrictEqual({ kind: "retry", waitMs });
  });

  it("rests the provider and moves on after two retries", () => {
    expect(stepAfter({ ...first, attempts: 3, retries: 2 })).toStrictEqual({
      kind: "next",
      restMs: 0,
    });
  });

  it("moves on at once when the provider asks for more than 60 s, resting it that long", () => {
    expect(stepAfter({ ...first, retryAfterMs: 120_000 })).toStrictEqual({
      kind: "next",
      restMs: 120_000,
    });
  });

  it.each(["auth", "billing", "request"] as const)(
    "moves a %s failure to the next model without a retry or a rest",
    (failure) => {
      expect(stepAfter({ ...first, failure })).toStrictEqual({ kind: "next" });
    },
  );

  it.each(["context", "refused", "aborted"] as const)(
    "ends the call on a %s failure",
    (failure) => {
      expect(stepAfter({ ...first, failure })).toStrictEqual({ kind: "end" });
    },
  );

  it.each(["transient", "auth", "request"] as const)(
    "never tries again or moves on once the turn committed, after %s",
    (failure) => {
      expect(stepAfter({ ...first, failure, committed: true })).toStrictEqual({ kind: "end" });
    },
  );

  it("ends the call at its fourth attempt, still resting a provider that kept failing", () => {
    expect(stepAfter({ ...first, attempts: 4, retries: 0 })).toStrictEqual({
      kind: "end",
      restMs: 0,
    });
    expect(stepAfter({ ...first, failure: "auth", attempts: 4 })).toStrictEqual({ kind: "end" });
  });
});
