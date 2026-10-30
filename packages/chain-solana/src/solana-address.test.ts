import type { Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  parseSolanaAddress,
  solanaAddressFromBytes,
  solanaAddressToBytes,
} from "./solana-address.js";

const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function unwrap<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

describe("a Solana address", () => {
  it("parses base58 text that decodes to 32 bytes", () => {
    expect(parseSolanaAddress(usdcMint)).toStrictEqual({ ok: true, value: usdcMint });
    expect(parseSolanaAddress("11111111111111111111111111111111")).toMatchObject({ ok: true });
  });

  it.each([
    ["text that decodes to fewer than 32 bytes", "1111"],
    ["text that decodes to more than 32 bytes", `${usdcMint}1`],
    ["a letter base58 leaves out", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10"],
    ["an EVM address", "0x168E0c5AE6B259883D878C89C042ad6347F8ba85"],
    ["empty text", ""],
  ])("refuses %s", (_case, text) => {
    expect(parseSolanaAddress(text)).toStrictEqual({ ok: false, error: "malformed_address" });
    expect(solanaAddressToBytes(text)).toStrictEqual({ ok: false, error: "malformed_address" });
  });

  it("refuses bytes that are not 32 long", () => {
    expect(solanaAddressFromBytes(new Uint8Array(31))).toStrictEqual({
      ok: false,
      error: "malformed_address",
    });
    expect(solanaAddressFromBytes(new Uint8Array(33))).toMatchObject({ ok: false });
  });

  it("gives USDC's mint as the 32 bytes a ceiling holds", () => {
    expect(unwrap(solanaAddressToBytes(usdcMint))).toHaveLength(32);
  });
});
