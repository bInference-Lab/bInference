import { describe, expect, it } from "vitest";
import { looksLikeSecret } from "./looks-like-secret.js";

// Public BIP-39 test vectors: never a real wallet.
const twelve = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const twentyFour = [
  "legal winner thank year wave sausage worth useful",
  "legal winner thank year wave sausage worth useful",
  "legal winner thank year wave sausage worth title",
].join(" ");
const words = twentyFour.split(" ");

describe("looksLikeSecret", () => {
  it.each([
    ["a 12-word recovery phrase", twelve],
    ["a 24-word recovery phrase", twentyFour],
    ["a phrase one word a line", words.join("\n")],
    ["a numbered phrase", words.map((word, index) => `${String(index + 1)}. ${word}`).join("\n")],
    ["a capitalized phrase with commas", words.map((word) => word.toUpperCase()).join(", ")],
    ["a phrase inside a sentence", `my words are ${twelve}, keep them`],
    ["a phrase with one mistyped word", twelve.replace("sausage", "sausgae")],
    ["a private key", `0x${"4c0883a69102937d6231471b5dbb6204fe512961708279f".padEnd(64, "a")}`],
    ["a private key without 0x, in capitals", "4C0883A6".repeat(8)],
    ["a transaction hash, which a private key looks like", `see 0x${"9f".repeat(32)} on chain`],
    ["an owner key code in groups", "bnok1abcde fghij klmno pqrst uvwxy z2345 67abc"],
    ["a bot token", "send it to 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9 please"],
    ["a binference key", `binf_${"a1".repeat(10)}`],
  ])("finds %s", (_kind, text) => {
    expect(looksLikeSecret(text)).toBe(true);
  });

  it.each([
    ["a trade request", "swap 0.5 BNB to USDT with at most 1% slippage"],
    [
      "a long sentence of short words",
      "please check whether this token looks safe before buying more than three hundred dollars worth",
    ],
    ["an address", "send 10 USDT to 0x55d398326f99059fF775485246999027B3197955"],
    ["eleven list words", twelve.split(" ").slice(0, 11).join(" ")],
    ["a phrase with two mistyped words", twelve.replace("sausage", "x").replace("useful", "y")],
  ])("leaves %s alone", (_kind, text) => {
    expect(looksLikeSecret(text)).toBe(false);
  });
});
