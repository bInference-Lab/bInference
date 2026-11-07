import { describe, expect, it } from "vitest";
import { planEdits } from "./edit-plan.js";

const curlyQuote = String.fromCodePoint(0x201c, 0x201d);
const enDash = String.fromCodePoint(0x2013);

describe("planEdits", () => {
  it("makes each exact replacement against the text as it was", () => {
    const plan = planEdits("a = 1\nb = 2\nc = 3\n", [
      { oldText: "c = 3", newText: "c = 30" },
      { oldText: "a = 1", newText: "a = 10" },
    ]);
    expect(plan).toStrictEqual({
      ok: true,
      value: { text: "a = 10\nb = 2\nc = 30\n", replaced: 2, changed: true },
    });
  });

  it("finds text by a loose match of trailing spaces, quotes and dashes, and replaces the file's own span", () => {
    const text = `say ${curlyQuote.charAt(0)}hi${curlyQuote.charAt(1)}   \nrange 1${enDash}2\nend\n`;
    const plan = planEdits(text, [{ oldText: 'say "hi"\nrange 1-2', newText: "gone" }]);
    expect(plan).toStrictEqual({
      ok: true,
      value: { text: "gone\nend\n", replaced: 1, changed: true },
    });
  });

  it("keeps the file's line breaks and its byte order mark", () => {
    const plan = planEdits("﻿one\r\ntwo\r\n", [{ oldText: "one\ntwo", newText: "1\n2" }]);
    expect(plan).toStrictEqual({
      ok: true,
      value: { text: "﻿1\r\n2\r\n", replaced: 1, changed: true },
    });
  });

  it("refuses text that is missing, repeated or overlapping, and an empty old text", () => {
    expect(planEdits("abc", [{ oldText: "x", newText: "y" }])).toStrictEqual({
      ok: false,
      error: "file.no_match",
    });
    expect(planEdits("ab ab", [{ oldText: "ab", newText: "y" }])).toStrictEqual({
      ok: false,
      error: "file.many_matches",
    });
    expect(planEdits("x  \nx \n", [{ oldText: "x", newText: "y" }])).toStrictEqual({
      ok: false,
      error: "file.many_matches",
    });
    expect(planEdits("y  \ny \n", [{ oldText: "y\t", newText: "z" }])).toStrictEqual({
      ok: false,
      error: "file.many_matches",
    });
    expect(
      planEdits("abcdef", [
        { oldText: "abcd", newText: "1" },
        { oldText: "cdef", newText: "2" },
      ]),
    ).toStrictEqual({ ok: false, error: "file.overlap" });
    expect(planEdits("abc", [{ oldText: "", newText: "y" }])).toStrictEqual({
      ok: false,
      error: "file.no_match",
    });
  });

  it("says when the replacements leave the text as it was", () => {
    expect(planEdits("same", [{ oldText: "same", newText: "same" }])).toStrictEqual({
      ok: true,
      value: { text: "same", replaced: 0, changed: false },
    });
  });
});
