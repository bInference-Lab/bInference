import { describe, expect, it } from "vitest";
import { applyHunks } from "./patch-apply.js";
import { parsePatch, type PatchHunk } from "./patch-parse.js";

// The hunks of one update, written as a patch would write them.
function hunksOf(...lines: readonly string[]): readonly PatchHunk[] {
  const read = parsePatch(
    ["*** Begin Patch", "*** Update File: f", ...lines, "*** End Patch"].join("\n"),
  );
  const [operation] = read.ok ? read.value : [];
  return operation?.kind === "update" ? operation.hunks : [];
}

const quote = (code: number) => String.fromCodePoint(code);

describe("applyHunks", () => {
  it("makes each hunk after the one before", () => {
    const hunks = hunksOf("@@", " a", "-b", "+1", "@@", " c", "-b", "+2");
    expect(applyHunks("a\nb\nc\nb\n", hunks, "f")).toStrictEqual({
      ok: true,
      value: "a\n1\nc\n2\n",
    });
  });

  it("refuses lines that stand more than once, quoting them, and a @@ line that does", () => {
    const twice = applyHunks("a\nb\na\nb\n", hunksOf("@@", "-a", "+x"), "src/a.ts");
    expect(twice).toStrictEqual({
      ok: false,
      error:
        "change 1 of src/a.ts: these lines stand 2 times in the file; add lines around them so they stand once:\na",
    });
    const anchors = applyHunks("fn\nx\nfn\nx\n", hunksOf("@@ fn", "-x", "+y"), "f");
    expect(anchors).toMatchObject({
      ok: false,
      error: expect.stringContaining("the line after @@ stands 2 times") as string,
    });
  });

  it("places a hunk after the line named by @@, and one tied to the end at the end only", () => {
    expect(applyHunks("x\nfn a\nx\nfn b\nx\n", hunksOf("@@ fn b", "-x", "+y"), "f")).toStrictEqual({
      ok: true,
      value: "x\nfn a\nx\nfn b\ny\n",
    });
    expect(applyHunks("x\nx\n", hunksOf("@@", "-x", "+z", "*** End of File"), "f")).toStrictEqual({
      ok: true,
      value: "x\nz\n",
    });
  });

  it("puts added lines right after their @@ line, and at the end without one", () => {
    expect(applyHunks("a\nb\n", hunksOf("@@ a", "+inserted"), "f")).toStrictEqual({
      ok: true,
      value: "a\ninserted\nb\n",
    });
    expect(applyHunks("a\r\n", hunksOf("@@", "+b"), "f")).toStrictEqual({
      ok: true,
      value: "a\r\nb\r\n",
    });
  });

  it("finds lines that differ only in spaces or curly quotes, and keeps the file's own context lines", () => {
    const text = `  keep  \nsay ${quote(0x201c)}hi${quote(0x201d)}\n`;
    expect(applyHunks(text, hunksOf("@@", " keep", '-say "hi"', "+done"), "f")).toStrictEqual({
      ok: true,
      value: "  keep  \ndone\n",
    });
  });

  it("keeps each line's own line break and a missing last one", () => {
    expect(applyHunks("a\r\nb\nc", hunksOf("@@", "-b", "+B"), "f")).toStrictEqual({
      ok: true,
      value: "a\r\nB\nc",
    });
    expect(applyHunks("a\nb", hunksOf("@@", "+c"), "f")).toStrictEqual({
      ok: true,
      value: "a\nb\nc",
    });
    expect(applyHunks("a\nb", hunksOf("@@", "-b", "+c", ""), "f")).toStrictEqual({
      ok: true,
      value: "a\nc",
    });
  });

  it("names the hunk it cannot place with its lines, and the missing @@ line", () => {
    expect(
      applyHunks("a\n", hunksOf("@@", "-a", "+b", "@@", "-zz", "+c"), "src/a.ts"),
    ).toStrictEqual({
      ok: false,
      error: "change 2 of src/a.ts: these lines are not in the file; read the file again:\nzz",
    });
    expect(applyHunks("a\n", hunksOf("@@ nope", "-a", "+b"), "f")).toStrictEqual({
      ok: false,
      error: "change 1 of f: the line after @@ is not in the file",
    });
  });

  it("keeps a byte order mark, and empties a file whose lines all go", () => {
    const bom = quote(0xfeff);
    expect(applyHunks(`${bom}a\n`, hunksOf("@@", "-a", "+b"), "f")).toStrictEqual({
      ok: true,
      value: `${bom}b\n`,
    });
    expect(applyHunks("a\n", hunksOf("@@", "-a"), "f")).toStrictEqual({ ok: true, value: "" });
  });

  it("keeps the file's own context lines among several changes, and line breaks of fewer or more lines", () => {
    const text = "  one  \r\ntwo\nthree\n  four  \n";
    const hunks = hunksOf("@@", " one", "-two", "-three", "+2", " four");
    expect(applyHunks(text, hunks, "f")).toStrictEqual({
      ok: true,
      value: "  one  \r\n2\n  four  \n",
    });
    const more = hunksOf("@@", " one", "-two", "+2a", "+2b", "+2c");
    expect(applyHunks("one\r\ntwo\r\n", more, "f")).toStrictEqual({
      ok: true,
      value: "one\r\n2a\r\n2b\r\n2c\r\n",
    });
    const tail = hunksOf("@@", " a", "-b", "+c", "");
    expect(applyHunks("a\nb", tail, "f")).toStrictEqual({ ok: true, value: "a\nc" });
  });

  it("writes a file of one line with no line break, and lets go of a hunk's last empty line alone", () => {
    expect(applyHunks("a", hunksOf("@@", "-a", "+b", "+c"), "f")).toStrictEqual({
      ok: true,
      value: "b\nc",
    });
    expect(applyHunks("a\nb", hunksOf("@@", "-b", "-", "+B", "+C"), "f")).toStrictEqual({
      ok: true,
      value: "a\nB\nC",
    });
  });

  it("adds lines to an empty file with the line break files write most", () => {
    expect(applyHunks("", hunksOf("@@", "+a", "+b"), "f")).toStrictEqual({
      ok: true,
      value: "a\nb\n",
    });
  });
});
