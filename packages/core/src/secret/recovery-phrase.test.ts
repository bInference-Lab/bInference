import { describe, expect, it } from "vitest";
import { holdsRecoveryPhrase, recoveryPhraseSpans } from "./recovery-phrase.js";

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
const twelve = listed.slice(0, 12);

describe("recoveryPhraseSpans", () => {
  it("finds 12 words of the list in a row, and takes the listed words after them", () => {
    const text = `words: ${listed.join(" ")}!`;
    expect(recoveryPhraseSpans(text)).toStrictEqual([{ start: 7, end: text.length - 1 }]);
  });

  it("gives a phrase in capitals the span it takes in the text", () => {
    const text = `words: ${twelve.join(" ").toUpperCase()}.`;
    expect(recoveryPhraseSpans(text)).toStrictEqual([{ start: 7, end: text.length - 1 }]);
  });

  it.each([
    ["one a line", twelve.join("\n")],
    ["as a numbered list", twelve.map((word, n) => `${String(n + 1)}. ${word}`).join("\n")],
    ["split by commas", twelve.join(", ")],
    ["in capitals", twelve.join(" ").toUpperCase()],
    [
      "with each word capitalized",
      twelve.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" "),
    ],
  ])("finds a phrase written %s", (_how, text) => {
    expect(holdsRecoveryPhrase(text)).toBe(true);
  });

  it.each([
    ["11 words of the list", twelve.slice(0, 11).join(" ")],
    ["prose that mixes in other words", `${twelve.slice(0, 6).join(" ")} and then the rest`],
    ["a transaction hash", `0x${"ab".repeat(32)}`],
    ["words that are not on the list", Array.from({ length: 12 }, () => "kettle").join(" ")],
  ])("finds none in %s", (_what, text) => {
    expect(holdsRecoveryPhrase(text)).toBe(false);
  });
});
