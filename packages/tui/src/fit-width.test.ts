import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import { fitWidth, tailWidth } from "./fit-width.js";

const wide = String.fromCodePoint(0x4e2d, 0x6587, 0x5bf9, 0x8bdd);

describe("fitting text to the terminal's width", () => {
  it("keeps text that fits", () => {
    expect(fitWidth("Confirm swap", 20)).toBe("Confirm swap");
    expect(tailWidth("Confirm swap", 20)).toBe("Confirm swap");
  });

  it("cuts the end, or keeps the end, of text that does not fit", () => {
    expect(fitWidth("Confirm swap", 8)).toBe("Confirm…");
    expect(tailWidth("Confirm swap", 8)).toBe("…rm swap");
  });

  it("counts two columns for each wide character", () => {
    expect(fitWidth(wide, 5)).toBe(`${wide.slice(0, 2)}…`);
    expect(stringWidth(fitWidth(wide, 5))).toBe(5);
    expect(stringWidth(tailWidth(wide, 6))).toBeLessThanOrEqual(6);
  });

  it.each([1, 2, 3, 4, 5])("never comes out wider than %i columns", (columns) => {
    const emoji = String.fromCodePoint(0x1f9ea, 0x1f7e1, 0x2705);
    expect(stringWidth(fitWidth(`${emoji}${wide}`, columns))).toBeLessThanOrEqual(columns);
    expect(stringWidth(tailWidth(`${wide}${emoji}`, columns))).toBeLessThanOrEqual(columns);
  });
});
