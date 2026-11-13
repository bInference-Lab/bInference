import { BinferenceError, type ErrorCode } from "@binference/core";
import { describe, expect, it } from "vitest";
import { isLeaseLost, throwIfLeaseLost } from "./lease-lost.js";

const fault = (code: ErrorCode) => new BinferenceError({ code, message: "A store fault." });

describe("a lost lease", () => {
  it.each(["store.lease_lost", "store.lease_mismatch", "store.commit_unknown"] as const)(
    "is %s, which is thrown on untouched",
    (code) => {
      const lost = fault(code);
      expect(isLeaseLost(lost)).toBe(true);
      expect(() => {
        throwIfLeaseLost(lost);
      }).toThrow(lost);
    },
  );

  it.each<readonly [string, () => Error["cause"]]>([
    ["another store code", () => fault("store.timeout")],
    ["a custody code", () => fault("custody.signer_down")],
    ["an error with no code", () => new Error("store.lease_lost")],
    ["no error at all", () => "store.lease_lost"],
  ])("is never %s, which goes on to its catch", (_name, made) => {
    const other = made();
    expect(isLeaseLost(other)).toBe(false);
    expect(() => {
      throwIfLeaseLost(other);
    }).not.toThrow();
  });
});
