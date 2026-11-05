import { describe, expect, it } from "vitest";
import { compactLine, maxLineChars } from "./progress-lines.js";

describe("compactLine", () => {
  it("folds spaces and line breaks, and keeps a line that fits whole", () => {
    expect(compactLine("  Let me\n\nlook   now ", maxLineChars)).toBe("Let me look now");
  });

  it("cuts a long line at a word's end past 60% of it, and ends it with an ellipsis", () => {
    const words = Array.from({ length: 40 }, (_, at) => `word${String(at)}`).join(" ");
    const cut = compactLine(words, maxLineChars);
    expect(Array.from(cut).length).toBeLessThanOrEqual(maxLineChars);
    expect(cut.endsWith("word17…")).toBe(true);
  });

  it("cuts one long word at the limit, counting characters by code point", () => {
    const face = String.fromCodePoint(0x1f600);
    const cut = compactLine(face.repeat(400), maxLineChars);
    expect(Array.from(cut)).toHaveLength(maxLineChars);
    expect(cut.endsWith(`${face}…`)).toBe(true);
  });
});
