import type { Result } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solanaAddressFromBytes, solanaAddressToBytes } from "./solana-address.js";

function unwrap<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

describe("the Solana address codec", () => {
  it("spells any 32 bytes as an address that decodes back to the same bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        const text = unwrap(solanaAddressFromBytes(bytes));
        expect(solanaAddressToBytes(text)).toStrictEqual({ ok: true, value: bytes });
      }),
    );
  });

  it("refuses every length of bytes but 32", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 64 }).filter((bytes) => bytes.length !== 32),
        (bytes) => {
          expect(solanaAddressFromBytes(bytes)).toStrictEqual({
            ok: false,
            error: "malformed_address",
          });
        },
      ),
    );
  });
});
