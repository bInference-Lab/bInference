import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { argumentsRefusal } from "./listed-mcp-arguments.js";

const phrase = [
  "abandon",
  "ability",
  "able",
  "about",
  "above",
  "absent",
  "absorb",
  "abstract",
  "absurd",
  "abuse",
  "access",
  "accident",
];

// From a Latin letter to its full-width form: `a` is U+0061, and its full-width form U+FF41.
const fullWidthShift = 0xfee0;

describe("argumentsRefusal", () => {
  it.each<readonly [string, JsonValue]>([
    [
      "a plain question of 12 short words",
      {
        query: "show recent large trades from wallets that bought this token during the last hour",
      },
    ],
    ["a transaction hash", { hash: `0x${"ab".repeat(32)}` }],
    ["eleven words of the list", { words: phrase.slice(0, 11) }],
  ])("sends %s", (_what, args) => {
    expect(argumentsRefusal(args)).toBeUndefined();
  });

  it.each<readonly [string, JsonValue]>([
    ["a phrase in one string", { query: phrase.join(" ") }],
    ["a phrase split by line breaks", { query: phrase.join("\n") }],
    ["a phrase sent as a list, word by word", { words: phrase }],
    ["a phrase deep in the arguments", { filter: { notes: [{ text: phrase.join(" ") }] } }],
    ["a phrase in capitals", { query: phrase.join(" ").toUpperCase() }],
    [
      "a phrase with each word capitalized",
      { words: phrase.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`) },
    ],
    [
      "a phrase in full-width letters",
      {
        query: phrase
          .join(" ")
          .replace(/[a-z]/g, (letter) =>
            String.fromCharCode(letter.charCodeAt(0) + fullWidthShift),
          ),
      },
    ],
    ["a private key block", { key: "-----BEGIN EC PRIVATE KEY-----" }],
    ["a binference token", { token: "bnt_0123456789abcdefghij" }],
  ])("refuses %s as a secret", (_what, args) => {
    expect(argumentsRefusal(args)).toBe("secret");
  });

  it("refuses arguments past 8 KiB as JSON", () => {
    expect(argumentsRefusal({ query: "x".repeat(8_200) })).toBe("too_large");
  });
});
