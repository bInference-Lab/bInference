import { describe, expect, it } from "vitest";
import { masked, standInsOf, withValues } from "./credential-stand-ins.js";

describe("credential stand-ins", () => {
  it("finds each credential a text names once, in order", () => {
    const text = "{{credential:B_KEY}} {{credential:A_KEY}} {{credential:B_KEY}}";
    expect(standInsOf(text)).toStrictEqual({ names: ["B_KEY", "A_KEY"], malformed: false });
    expect(standInsOf("no stand-in")).toStrictEqual({ names: [], malformed: false });
  });

  it.each([
    "{{credential:lower}}",
    "{{credential: SPACED}}",
    "{{credential:OPEN",
    "{{credential:{{credential:A_KEY}}",
  ])("finds %s malformed", (text) => {
    expect(standInsOf(text).malformed).toBe(true);
  });

  it("puts each known value in, encoded as asked, and leaves other names alone", () => {
    const values = new Map([["A_KEY", "x$&y z"]]);
    const text = "a={{credential:A_KEY}}&b={{credential:B_KEY}}";
    expect(withValues(text, values)).toBe("a=x$&y z&b={{credential:B_KEY}}");
    expect(withValues(text, values, encodeURIComponent)).toBe(
      "a=x%24%26y%20z&b={{credential:B_KEY}}",
    );
  });

  it("masks each value, as it is and percent-encoded, the longest first", () => {
    const values = new Map([
      ["SHORT", "abc"],
      ["LONG", "abc def.*"],
    ]);
    const text = "abc def.* then abc then abc%20def.* and abcd";
    expect(masked(text, values)).toBe(
      "{{credential:LONG}} then {{credential:SHORT}} then {{credential:LONG}} and {{credential:SHORT}}d",
    );
    expect(masked(text, new Map())).toBe(text);
  });
});
