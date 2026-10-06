import { describe, expect, it } from "vitest";
import { looksLikeSecret } from "./looks-like-secret.js";

// The first characters of the BIP-39 simplified Chinese list: a test phrase, never a wallet.
const characters = ["的", "一", "是", "在", "不", "了", "有", "和", "人", "这", "中", "大"];

describe("looksLikeSecret in Chinese", () => {
  it("finds a Chinese recovery phrase, one character a word", () => {
    expect(looksLikeSecret(characters.join(" "))).toBe(true);
    expect(looksLikeSecret(characters.join("\n"))).toBe(true);
    expect(looksLikeSecret(characters.join("、"))).toBe(true);
  });

  it("leaves Chinese sentences alone", () => {
    expect(looksLikeSecret(characters.join(""))).toBe(false);
    expect(looksLikeSecret("帮我用 0.5 BNB 买入 USDT，滑点上限 1%")).toBe(false);
    expect(looksLikeSecret(characters.slice(0, 11).join(" "))).toBe(false);
  });
});
