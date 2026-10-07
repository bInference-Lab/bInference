import {
  createSecret,
  redactedMark,
  redactSecrets,
  type Result,
  secretMark,
} from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatOwnerKeyCode,
  type OwnerKeyCodeProblem,
  parseOwnerKeyCode,
} from "./owner-key-code.js";
import { createP256KeyPair, type P256KeyPair, p256KeyPairFromScalar } from "./p256-key-pair.js";

const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const alphabet = "abcdefghijklmnopqrstuvwxyz234567";

// Made with Python's hashlib and base64 modules, apart from this code: the scalar, then the first
// 4 bytes of SHA-256 over "bnok1" and the scalar, in base32 without padding, lowercase.
const knownCodes: readonly (readonly [bigint, string])[] = [
  [1n, "bnok1aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa ay3eq 6la"],
  [order - 1n, "bnok177777 7yaaa aab77 77777 77777 66on6 vnu4l z5bht xhfmf 7ddev iokks kq4"],
];
const [[, firstCode], [, lastCode]] = [knownCodes[0] ?? [0n, ""], knownCodes[1] ?? [0n, ""]];
// The same recipe over scalars that are no key: zero and the curve's order.
const checksummedNonKeys = [
  "bnok1aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa ajmnj sba",
  "bnok177777 7yaaa aab77 77777 77777 66on6 vnu4l z5bht xhfmf 7ddev i7un5 yim",
];

function pairFrom(value: bigint): P256KeyPair {
  const pair = p256KeyPairFromScalar(Buffer.from(value.toString(16).padStart(64, "0"), "hex"));
  if (!pair.ok) {
    throw new Error(`no pair for the test scalar ${String(value)}`);
  }
  return pair.value;
}

const codeOf = (pair: P256KeyPair): string => formatOwnerKeyCode(pair).reveal();
const parse = (text: string): Result<P256KeyPair, OwnerKeyCodeProblem> =>
  parseOwnerKeyCode(createSecret(text));
const publicKeyOf = (text: string): string => {
  const parsed = parse(text);
  return parsed.ok ? parsed.value.publicKey : parsed.error;
};

// The code's base32 characters without the prefix and the spaces.
const bodyOf = (code: string): string => code.slice("bnok1".length).replaceAll(" ", "");

// Every code that differs from the given one in exactly one base32 character.
function oneCharacterTypos(code: string): readonly string[] {
  const body = bodyOf(code);
  return body.split("").flatMap((original, position) =>
    alphabet
      .split("")
      .filter((other) => other !== original)
      .map((other) => `bnok1${body.slice(0, position)}${other}${body.slice(position + 1)}`),
  );
}

const scalars = fc.bigInt({ min: 1n, max: order - 1n });

describe("owner key code", () => {
  it.each(knownCodes)("writes the known code of the scalar %s", (value, code) => {
    const pair = pairFrom(value);

    expect(codeOf(pair)).toBe(code);
    expect(publicKeyOf(code)).toBe(pair.publicKey);
  });

  it("writes bnok1 and 58 base32 characters in groups of five split by spaces", () => {
    const code = codeOf(createP256KeyPair());

    expect(code).toMatch(/^bnok1(?:[a-z2-7]{5} ){11}[a-z2-7]{3}$/);
  });

  it("reads back the key of any code it writes", () => {
    fc.assert(
      fc.property(scalars, (value) => {
        const pair = pairFrom(value);
        expect(publicKeyOf(codeOf(pair))).toBe(pair.publicKey);
      }),
      { numRuns: 200 },
    );
  });

  it("reads a code typed in capitals, without spaces, with dashes or across lines", () => {
    const pair = createP256KeyPair();
    const code = codeOf(pair);
    const forms = [
      code.toUpperCase(),
      code.replaceAll(" ", ""),
      code.replaceAll(" ", "-"),
      ` ${code.replaceAll(" ", "\n")}\r\n`,
    ];

    expect(forms.map(publicKeyOf)).toStrictEqual(forms.map(() => pair.publicKey));
  });

  it("refuses every code with one wrong character, by its checksum or the unused bits", () => {
    const outcomes = oneCharacterTypos(lastCode).map(publicKeyOf);

    // 58 characters, each replaced by the 31 others. The last character ends in 2 bits past the
    // 36 bytes, which must be zero: its 24 typos that set them are not canonical base32, and its
    // other 7 change the checksum's last byte.
    expect(outcomes).toHaveLength(58 * 31);
    expect(outcomes.filter((outcome) => outcome === "checksum_mismatch")).toHaveLength(57 * 31 + 7);
    expect(outcomes.filter((outcome) => outcome === "malformed")).toHaveLength(24);
  });

  it("refuses a random key's code with a random wrong character", () => {
    fc.assert(
      fc.property(scalars, fc.nat(57), fc.nat(30), (value, position, shift) => {
        const body = bodyOf(codeOf(pairFrom(value)));
        const original = alphabet.indexOf(body.charAt(position));
        const typo = alphabet.charAt((original + shift + 1) % alphabet.length);
        const code = `bnok1${body.slice(0, position)}${typo}${body.slice(position + 1)}`;
        expect(parse(code).ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("refuses a random key's code with two neighbours swapped", () => {
    fc.assert(
      fc.property(scalars, fc.nat(56), (value, position) => {
        const body = bodyOf(codeOf(pairFrom(value)));
        const swapped = `${body.slice(0, position)}${body.charAt(position + 1)}${body.charAt(position)}${body.slice(position + 2)}`;
        fc.pre(swapped !== body);
        expect(parse(`bnok1${swapped}`).ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it.each([
    ["no prefix", (code: string) => code.slice(5)],
    ["another version", (code: string) => code.replace("bnok1", "bnok2")],
    ["another prefix", (code: string) => code.replace("bnok1", "bnak1")],
    ["a group left out", (code: string) => code.replace(/ [a-z2-7]{5} /, " ")],
    ["one character more", (code: string) => `${code}a`],
    ["one character less", (code: string) => code.slice(0, -1)],
    ["a character outside base32", (code: string) => code.replace(/[a-z2-7]$/, "1")],
    ["a letter outside ASCII", (code: string) => code.replace(/[a-z2-7]$/, "é")],
    ["nothing at all", () => ""],
  ])("refuses a code with %s as malformed", (_case, change) => {
    expect(publicKeyOf(change(firstCode))).toBe("malformed");
  });

  it.each(checksummedNonKeys)("refuses %s, whose checksum covers no key", (code) => {
    expect(publicKeyOf(code)).toBe("malformed");
  });

  it("keeps the code a secret that core's redaction masks whole", () => {
    const code = formatOwnerKeyCode(createP256KeyPair());

    expect([String(code), JSON.stringify(code)]).toStrictEqual([secretMark, `"${secretMark}"`]);
    expect(redactSecrets(`code: ${code.reveal()}.`)).toBe(`code: ${redactedMark}.`);
  });
});
