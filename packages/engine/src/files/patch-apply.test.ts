import { describe, expect, it } from "vitest";
import { applyHunks } from "./patch-apply.js";
import type { PatchHunk } from "./patch-parse.js";

const hunk = (
  oldLines: readonly string[],
  newLines: readonly string[],
  more: Partial<PatchHunk> = {},
): PatchHunk => ({
  oldLines,
  newLines,
  atEnd: false,
  ...more,
});

describe("applyHunks", () => {
  it("makes each hunk after the one before, keeping a last line break", () => {
    const text = "a\nb\na\nb\n";
    expect(applyHunks(text, [hunk(["a", "b"], ["1"]), hunk(["a", "b"], ["2"])], "f")).toStrictEqual(
      { ok: true, value: "1\n2\n" },
    );
  });

  it("places a hunk after the line named by @@, and one tied to the end at the end", () => {
    const text = "x\nfn a\nx\nfn b\nx\n";
    expect(applyHunks(text, [hunk(["x"], ["y"], { anchor: "fn b" })], "f")).toStrictEqual({
      ok: true,
      value: "x\nfn a\nx\nfn b\ny\n",
    });
    expect(applyHunks("x\nx\n", [hunk(["x"], ["z"], { atEnd: true })], "f")).toStrictEqual({
      ok: true,
      value: "x\nz\n",
    });
  });

  it("finds lines that differ only in spaces or curly quotes", () => {
    const quoted = `say ${String.fromCodePoint(0x201c)}hi${String.fromCodePoint(0x201d)}`;
    expect(
      applyHunks(`  keep  \n${quoted}\n`, [hunk(["keep", 'say "hi"'], ["done"])], "f"),
    ).toStrictEqual({ ok: true, value: "done\n" });
  });

  it("adds lines with no old lines at the end, and keeps CRLF", () => {
    expect(applyHunks("a\r\n", [hunk([], ["b"])], "f")).toStrictEqual({
      ok: true,
      value: "a\r\nb\r\n",
    });
  });

  it("lets a last empty line go when only that keeps a hunk out", () => {
    expect(applyHunks("a\nb", [hunk(["b", ""], ["c", ""])], "f")).toStrictEqual({
      ok: true,
      value: "a\nc\n",
    });
  });

  it("names the hunk it cannot place, and the missing @@ line", () => {
    expect(applyHunks("a\n", [hunk(["a"], ["b"]), hunk(["zz"], ["c"])], "src/a.ts")).toMatchObject({
      ok: false,
      error: "change 2 of src/a.ts: the lines it changes are not in the file; read the file again",
    });
    expect(applyHunks("a\n", [hunk(["a"], ["b"], { anchor: "nope" })], "f")).toMatchObject({
      ok: false,
      error: "change 1 of f: the line after @@ is not in the file",
    });
    expect(applyHunks("a\n", [hunk(["q", ""], ["b"])], "f")).toMatchObject({ ok: false });
  });

  it("empties a file whose lines all go", () => {
    expect(applyHunks("a\n", [hunk(["a"], [])], "f")).toStrictEqual({ ok: true, value: "" });
  });
});
