import { describe, expect, it } from "vitest";
import { maskShellOutput } from "./mask-output.js";

const listed = [
  "apple",
  "brick",
  "cable",
  "dance",
  "eagle",
  "fabric",
  "giant",
  "habit",
  "ice",
  "jacket",
  "kitchen",
  "ladder",
  "magnet",
];
const twelve = listed.slice(0, 12).join(" ");

describe("masking a command's output", () => {
  it("hides a private key block of any kind", () => {
    const block = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----";
    expect(maskShellOutput(`a\n${block}\nb`)).toBe("a\n[private key hidden]\nb");
  });

  it("hides 12 words of the list in a row, and the words after them in the same run", () => {
    expect(maskShellOutput(`words: ${twelve} magnet!`)).toBe("words: [recovery phrase hidden]!");
  });

  it("hides a phrase in capitals, or with each word capitalized", () => {
    const capitalized = twelve.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    expect(maskShellOutput(`A ${twelve.toUpperCase()} B`)).toBe("A [recovery phrase hidden] B");
    expect(maskShellOutput(`${capitalized}\n`)).toBe("[recovery phrase hidden]\n");
  });

  it("hides a phrase written as a numbered list", () => {
    const numbered = listed
      .slice(0, 12)
      .map((each, index) => `${String(index + 1)}. ${each}`)
      .join("\n");
    expect(maskShellOutput(numbered)).toBe("1. [recovery phrase hidden]");
  });

  it("keeps 11 words of the list, prose that mixes in other words, and a transaction hash", () => {
    const eleven = listed.slice(0, 11).join(" ");
    const prose = `${listed.slice(0, 6).join(" ")} and then ${listed.slice(6, 12).join(" ")}`;
    const hash = `0x${"ab".repeat(32)}`;
    for (const text of [eleven, prose, hash]) {
      expect(maskShellOutput(text)).toBe(text);
    }
  });
});
