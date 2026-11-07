import { describe, expect, it } from "vitest";
import { byteOrderMark } from "./byte-order-mark.js";
import { planEdits } from "./edit-plan.js";

const curly = String.fromCodePoint(0x201c, 0x201d);
const enDash = String.fromCodePoint(0x2013);
const planned = (text: string, replaced: number, changed = true) => ({
  kind: "planned",
  plan: { text, replaced, changed },
});

describe("planEdits", () => {
  it("makes each exact replacement against the text as it was", () => {
    const plan = planEdits("a = 1\nb = 2\nc = 3\n", [
      { oldText: "c = 3", newText: "c = 30" },
      { oldText: "a = 1", newText: "a = 10" },
    ]);
    expect(plan).toStrictEqual(planned("a = 10\nb = 2\nc = 30\n", 2));
  });

  it("finds text by a loose match of spaces, quotes, dashes and compatible characters", () => {
    const text = `say ${curly.charAt(0)}hi${curly.charAt(1)}   \nrange 1${enDash}2\n${String.fromCodePoint(0xff21)}\nend\n`;
    const plan = planEdits(text, [{ oldText: 'say "hi"\nrange 1-2\nA', newText: "gone" }]);
    expect(plan).toStrictEqual(planned("gone\nend\n", 1));
  });

  it("keeps each line's own line break and the byte order mark", () => {
    const mixed = planEdits(`${byteOrderMark}one\r\ntwo\nthree\r\n`, [
      { oldText: "two\nthree", newText: "2\n3" },
    ]);
    expect(mixed).toStrictEqual(planned(`${byteOrderMark}one\r\n2\n3\r\n`, 1));
    const inLine = planEdits("a\r\nb\r\n", [{ oldText: "b", newText: "x\ny" }]);
    expect(inLine).toStrictEqual(planned("a\r\nx\r\ny\r\n", 1));
  });

  it("names the edit whose text is missing, repeated or overlapping", () => {
    expect(planEdits("abc", [{ oldText: "x", newText: "y" }])).toStrictEqual({
      kind: "refused",
      problem: { kind: "no_match", index: 0 },
    });
    expect(
      planEdits("ab ab", [
        { oldText: "a", newText: "b" },
        { oldText: "ab", newText: "y" },
      ]),
    ).toStrictEqual({
      kind: "refused",
      problem: { kind: "many_matches", index: 0, count: 2 },
    });
    expect(
      planEdits("x  \nx \n", [
        { oldText: "y", newText: "" },
        { oldText: "x\t", newText: "z" },
      ]),
    ).toMatchObject({
      problem: { kind: "no_match", index: 0 },
    });
    expect(planEdits("y  \ny \n", [{ oldText: "y\t", newText: "z" }])).toStrictEqual({
      kind: "refused",
      problem: { kind: "many_matches", index: 0, count: 2 },
    });
    expect(
      planEdits("abcdef", [
        { oldText: "abcd", newText: "1" },
        { oldText: "cdef", newText: "2" },
      ]),
    ).toStrictEqual({
      kind: "refused",
      problem: { kind: "overlap", index: 0, other: 1 },
    });
    expect(planEdits("abc", [{ oldText: "", newText: "y" }])).toMatchObject({
      problem: { kind: "no_match" },
    });
  });

  it("says when the replacements leave the text as it was", () => {
    expect(planEdits("same", [{ oldText: "same", newText: "same" }])).toStrictEqual(
      planned("same", 0, false),
    );
  });
});
