import { err, ok, type Result } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recipientHex, recipientHexBytes } from "./recipient-bytes.js";

// The encoding as it was on Node's Buffer, which the console's bundle lacks and tests may use.
function bufferHex(bytes: Readonly<Uint8Array>): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function bufferHexBytes(text: string): Result<Uint8Array, "malformed_hex"> {
  return /^0x(?:[0-9a-f]{2})+$/.test(text)
    ? ok(Uint8Array.from(Buffer.from(text.slice(2), "hex")))
    : err("malformed_hex");
}

const upperHex = (value: Readonly<Uint8Array>): string => bufferHex(value).toUpperCase();
const unprefixedHex = (value: Readonly<Uint8Array>): string => bufferHex(value).slice(2);
const oddHex = (value: Readonly<Uint8Array>): string => bufferHex(value).slice(0, -1);

const bytes = fc.uint8Array({ maxLength: 64 });
// Hex of real bytes, the same with its case, prefix or length broken, and any other text.
const text = fc.oneof(
  bytes.map(bufferHex),
  bytes.map(upperHex),
  bytes.map(unprefixedHex),
  bytes.map(oddHex),
  fc.stringMatching(/^(?:0x|0X)?[0-9a-fA-Fg]{0,9}$/),
  fc.string(),
);

describe("recipient bytes properties", () => {
  it("writes every byte string as Buffer wrote it", () => {
    fc.assert(
      fc.property(bytes, (value: Readonly<Uint8Array>) => {
        expect(recipientHex(value)).toBe(bufferHex(value));
      }),
    );
  });

  it("reads and refuses every text as Buffer did", () => {
    fc.assert(
      fc.property(text, (value) => {
        expect(recipientHexBytes(value)).toStrictEqual(bufferHexBytes(value));
      }),
    );
  });
});
