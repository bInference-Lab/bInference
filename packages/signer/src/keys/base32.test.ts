import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase32, encodeBase32 } from "./base32.js";

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("base32", () => {
  // RFC 4648, section 10, without the padding and in lowercase.
  it.each([
    ["", ""],
    ["f", "my"],
    ["fo", "mzxq"],
    ["foo", "mzxw6"],
    ["foob", "mzxw6yq"],
    ["fooba", "mzxw6ytb"],
    ["foobar", "mzxw6ytboi"],
  ])("encodes %j as the RFC's %j", (plain, encoded) => {
    expect(encodeBase32(bytesOf(plain))).toBe(encoded);
    expect(decodeBase32(encoded)).toStrictEqual(bytesOf(plain));
    expect(decodeBase32(encoded.toUpperCase())).toStrictEqual(bytesOf(plain));
  });

  it("decodes what it encodes, for any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(decodeBase32(encodeBase32(bytes))).toStrictEqual(bytes);
      }),
    );
  });

  it("writes only lowercase letters and the digits 2 to 7", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), (bytes) => {
        expect(encodeBase32(bytes)).toMatch(/^[a-z2-7]+$/);
      }),
    );
  });

  it.each([
    ["a padding sign", "my======"],
    ["a digit outside the alphabet", "m1"],
    ["the Kelvin sign that lowercases to k", "Ky"],
    ["a length no bytes encode to", "mzx"],
    ["one character alone", "m"],
    ["one character alone, even one with no bits set", "a"],
    ["set bits after the last byte", "mz"],
  ])("refuses %s", (_case, text) => {
    expect(decodeBase32(text)).toBeUndefined();
  });
});
