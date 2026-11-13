import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recoveryWords } from "./recovery-words.js";

// The SHA-256 of bip-0039/english.txt as bitcoin/bips publishes it: one word a line.
const publishedSha256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda";

describe("recoveryWords", () => {
  it("holds the published BIP-39 English list, word for word", () => {
    const text = `${[...recoveryWords].join("\n")}\n`;
    expect(recoveryWords.size).toBe(2048);
    expect(createHash("sha256").update(text).digest("hex")).toBe(publishedSha256);
  });
});
