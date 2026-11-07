import { describe, expect, it } from "vitest";
import { parsePatch } from "./patch-parse.js";

const patch = (...lines: readonly string[]) =>
  ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

describe("parsePatch", () => {
  it("reads added, deleted, updated and moved files with their hunks", () => {
    const read = parsePatch(
      patch(
        "*** Add File: notes.md",
        "+one",
        "+two",
        "*** Delete File: old.md",
        "*** Update File: src/a.ts",
        "*** Move to: src/b.ts",
        "@@ function main",
        " context",
        "-old",
        "+new",
        "@@",
        "+tail",
        "*** End of File",
      ),
    );
    expect(read).toStrictEqual({
      ok: true,
      value: [
        { kind: "add", path: "notes.md", lines: ["one", "two"] },
        { kind: "delete", path: "old.md" },
        {
          kind: "update",
          path: "src/a.ts",
          moveTo: "src/b.ts",
          hunks: [
            {
              anchor: "function main",
              oldLines: ["context", "old"],
              newLines: ["context", "new"],
              kept: [[0, 0]],
              atEnd: false,
            },
            { oldLines: [], newLines: ["tail"], kept: [], atEnd: true },
          ],
        },
      ],
    });
  });

  it("reads an empty line in a hunk as empty context, and CRLF line breaks", () => {
    const read = parsePatch(
      patch("*** Update File: a.md", "-x", "", "+y").replaceAll("\n", "\r\n"),
    );
    expect(read).toMatchObject({
      ok: true,
      value: [{ hunks: [{ oldLines: ["x", ""], newLines: ["", "y"] }] }],
    });
  });

  it.each([
    ["no begin or end", "*** Add File: a\n+x", "a patch starts with"],
    ["no file", patch(), "changes no file"],
    ["an unknown header", patch("*** Rename File: a"), "line 2 is no file header"],
    [
      "an added line without +",
      patch("*** Add File: a", "x"),
      "line 3, in the new file a, does not start with +",
    ],
    ["a path left out", patch("*** Delete File:   "), "names no file"],
    ["a move to nowhere", patch("*** Update File: a", "*** Move to: ", "+x"), "names no file"],
    ["an update with no change", patch("*** Update File: a"), "the update of a holds no change"],
    [
      "a hunk line without a mark",
      patch("*** Update File: a", "@@", "?x"),
      "line 4 starts with none",
    ],
  ])("answers why it cannot read %s", (_case, input, why) => {
    const read = parsePatch(input);
    expect(read).toMatchObject({ ok: false });
    expect(JSON.stringify(read)).toContain(why);
  });

  it("reads a patch written as a shell heredoc", () => {
    const read = parsePatch(
      ["<<'EOF'", "*** Begin Patch", "*** Delete File: a.md", "*** End Patch", "EOF"].join("\n"),
    );
    expect(read).toStrictEqual({ ok: true, value: [{ kind: "delete", path: "a.md" }] });
  });
});
