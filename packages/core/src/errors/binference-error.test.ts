import { describe, expect, it } from "vitest";
import { BinferenceError, isErrorCode } from "./binference-error.js";

describe("binference error", () => {
  it("carries its code, message and retry flag", () => {
    const error = new BinferenceError({
      code: "rpc.timeout",
      message: "The RPC did not answer.",
      retryable: true,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BinferenceError");
    expect(error.code).toBe("rpc.timeout");
    expect(error.message).toBe("The RPC did not answer.");
    expect(error.retryable).toBe(true);
    expect(error.details).toStrictEqual({});
  });

  it("is not retryable unless it says so", () => {
    expect(new BinferenceError({ code: "intent.expired", message: "Expired." }).retryable).toBe(
      false,
    );
  });

  it("keeps the error that caused it", () => {
    const cause = new Error("socket closed");
    const error = new BinferenceError({ code: "rpc.down", message: "Down.", cause });
    expect(error.cause).toBe(cause);
    expect("cause" in new BinferenceError({ code: "rpc.down", message: "Down." })).toBe(false);
  });

  it("redacts secrets in its string details and keeps other values", () => {
    const secret = `0x${"1f".repeat(32)}`;
    const error = new BinferenceError({
      code: "signer.refused",
      message: "Refused.",
      details: { input: `key ${secret}`, attempt: 2, isFinal: true },
    });
    expect(error.details).toStrictEqual({ input: "key [redacted]", attempt: 2, isFinal: true });
  });
});

describe("isErrorCode", () => {
  it.each(["rpc.timeout", "protocol.key_reused", "chain.rpc_down", "a.b.c"])(
    "accepts %s",
    (code) => {
      expect(isErrorCode(code)).toBe(true);
    },
  );

  it.each(["timeout", "Rpc.timeout", "rpc.", ".timeout", "rpc timeout", "rpc.time-out"])(
    "refuses %s",
    (code) => {
      expect(isErrorCode(code)).toBe(false);
    },
  );
});
