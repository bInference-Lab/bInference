import { describe, expect, it } from "vitest";
import { holdsNul, refuseNulText } from "./held-nul.schema.js";

const nul = "\u0000";

describe("refuseNulText", () => {
  it("finds U+0000 in a string or key at any depth, and never in bytes or numbers", () => {
    expect(holdsNul({ list: [{ text: `x${nul}` }] })).toBe(true);
    expect(holdsNul({ [`k${nul}`]: 1 })).toBe(true);
    expect(holdsNul({ bytes: new Uint8Array([0, 0]), amount: 0n, text: "fine" })).toBe(false);
    expect(holdsNul(String.raw`\u0000`)).toBe(false);
  });

  it("refuses input holding U+0000 with its store code, naming the call", () => {
    expect(() => refuseNulText({ text: nul }, "The note")).toThrow(
      expect.objectContaining({ code: "store.nul_text", details: { task: "The note" } }),
    );
    expect(() => refuseNulText({ text: "fine" }, "The note")).not.toThrow();
  });
});
