import { describe, expect, it } from "vitest";
import { readPrivyErrorCode, refusalOf } from "./privy-wire.schema.js";

// Each documented code with a description as Privy's API error page words it.
const documented = [
  ["policy_violation", "RPC request denied due to policy violation", "policy"],
  ["insufficient_funds", "Wallet has insufficient funds for this transaction", undefined],
  ["insufficient_funds", "Insufficient gas credits balance", undefined],
  ["transaction_broadcast_failure", "Transaction failed to broadcast to the network", undefined],
  [
    "missing_or_empty_authorization_header",
    "Missing `privy-authorization-signature` header or no signatures provided",
    "authorization",
  ],
  [
    "zero_correct_authorization_signatures",
    "No valid authorization signatures were provided",
    "authorization",
  ],
  [
    "insufficient_correct_authorization_signatures",
    "Not enough valid authorization signatures provided",
    "authorization",
  ],
  [
    "incorrect_quantity_of_authorization_signatures",
    "Number of signatures does not match the wallet's authorization threshold",
    "authorization",
  ],
  ["request_expired", "The request has expired", "expired"],
  ["no_valid_user_session_keys", "No valid user signing keys available", undefined],
  ["user_session_keys_expired", "User signing key is expired", undefined],
] as const;

describe("the API errors Privy documents", () => {
  it.each(documented)("reads %s from its code field", (code, _words, refusal) => {
    expect(readPrivyErrorCode({ code, error: "anything" })).toBe(code);
    expect(refusalOf(readPrivyErrorCode({ code }))).toBe(refusal);
  });

  it.each(documented)("reads %s from its description alone", (code, words, refusal) => {
    expect(readPrivyErrorCode({ error: words })).toBe(code);
    expect(refusalOf(readPrivyErrorCode({ error: words }))).toBe(refusal);
  });

  it("reads the answer Privy gave a signature from a key that may not sign", () => {
    // As the Privy test app answered on 2026-10-07: the description, no code field.
    const body = {
      error:
        "No valid authorization signatures were provided. Your payload may be malformed or your " +
        "signing keys may be incorrect or expired. Docs: https://docs.privy.io/api-reference/authorization-signatures",
    };
    expect(readPrivyErrorCode(body)).toBe("zero_correct_authorization_signatures");
    expect(refusalOf(readPrivyErrorCode(body))).toBe("authorization");
  });

  it("reads a code written into the error text in any case", () => {
    expect(readPrivyErrorCode({ error: " POLICY_VIOLATION " })).toBe("policy_violation");
  });

  it("names no code for an answer it cannot place", () => {
    expect(readPrivyErrorCode({ error: "Internal server error" })).toBeUndefined();
    expect(readPrivyErrorCode({ code: "not_a_documented_code" })).toBeUndefined();
    expect(readPrivyErrorCode("plain text")).toBeUndefined();
    expect(readPrivyErrorCode(undefined)).toBeUndefined();
    expect(refusalOf(undefined)).toBeUndefined();
  });
});
