import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { displayOutsideText } from "./outside-text.js";

const hidden = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

const plain = fc
  .string({ unit: "grapheme", maxLength: 40 })
  .filter((text) => !hidden.test(text) && Array.from(text).length <= 40);

describe("displayOutsideText", () => {
  it("shows ordinary text as it is", () => {
    expect(displayOutsideText("PancakeSwap v3", 40)).toBe("PancakeSwap v3");
  });

  it.each([
    ["a right-to-left override", "USD\u202ET", "USD\\u{202E}T"],
    ["a bidi isolate", "\u2066PEPE\u2069", "\\u{2066}PEPE\\u{2069}"],
    [
      "zero-width characters",
      "C\u200BA\u200CK\u200DE\u2060\uFEFF",
      "C\\u{200B}A\\u{200C}K\\u{200D}E\\u{2060}\\u{FEFF}",
    ],
    ["control characters", "A\nB\tC\u0000", "A\\u{A}B\\u{9}C\\u{0}"],
    ["a line separator", "A\u2028B", "A\\u{2028}B"],
    ["a lone surrogate", "A\uD800B", "A\\u{D800}B"],
  ])("makes %s visible", (_name, text, shown) => {
    expect(displayOutsideText(text, 40)).toBe(shown);
  });

  it("cuts text past its limit and ends it with an ellipsis", () => {
    expect(displayOutsideText("ABCDEFGHIJKLMNOPQ", 16)).toBe("ABCDEFGHIJKLMNO…");
    expect(displayOutsideText("ABCDEFGHIJKLMNOP", 16)).toBe("ABCDEFGHIJKLMNOP");
  });

  it("counts characters, not UTF-16 units", () => {
    const astral = String.fromCodePoint(0x1d400).repeat(16);
    expect(displayOutsideText(astral, 16)).toBe(astral);
  });

  it("never lets a hidden character through, and shows at most the limit of characters", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), fc.integer({ min: 1, max: 50 }), (text, limit) => {
        const shown = displayOutsideText(text, limit);
        const units = Array.from(shown.replaceAll(/\\u\{[\dA-F]+\}/g, "?"));
        expect(hidden.test(shown)).toBe(false);
        expect(units.length).toBeLessThanOrEqual(limit);
      }),
    );
  });

  it("shows text with nothing hidden and within its limit unchanged", () => {
    fc.assert(
      fc.property(plain, (text) => {
        expect(displayOutsideText(text, 40)).toBe(text);
      }),
    );
  });
});
