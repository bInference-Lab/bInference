import { describe, expect, it } from "vitest";
import { editProblemText } from "./edit-problems.js";

describe("editProblemText", () => {
  it("shows the closest lines with their numbers when the text is not there", () => {
    const text = "function add(a, b) {\n  return a + b;\n}\n";
    const said = editProblemText(
      { kind: "no_match", index: 0 },
      { text, oldTexts: ["  return a+b;"] },
    );
    expect(said.split("\n")).toStrictEqual([
      "The edit: its old text is not in the file. It must match exactly, every space and line break included.",
      "Closest lines in the file:",
      "line 2 (85% alike):   return a + b;",
    ]);
  });

  it("says when a line differs only in the spaces before it, and shows no hint for nothing alike", () => {
    const said = editProblemText(
      { kind: "no_match", index: 1 },
      { text: "    x = 1\n", oldTexts: ["a", "x = 1"] },
    );
    expect(said).toContain("edits[1]: its old text is not in the file.");
    expect(said).toContain("line 1 (100% alike, the same but for the spaces before it):     x = 1");
    expect(
      editProblemText({ kind: "no_match", index: 0 }, { text: "abc\n", oldTexts: ["zzzzzzzz"] }),
    ).not.toContain("Closest");
    expect(
      editProblemText({ kind: "no_match", index: 0 }, { text: "abc\n", oldTexts: ["\n"] }),
    ).not.toContain("Closest");
  });

  it("names the repeated and the overlapping edits", () => {
    expect(
      editProblemText(
        { kind: "many_matches", index: 2, count: 3 },
        { text: "", oldTexts: ["a", "b", "c"] },
      ),
    ).toBe(
      "edits[2]: its old text stands 3 times in the file and must stand once. Add lines around it.",
    );
    expect(
      editProblemText({ kind: "overlap", index: 0, other: 1 }, { text: "", oldTexts: ["a", "b"] }),
    ).toBe("edits[0] and edits[1] overlap. Merge them into one edit or change separate parts.");
  });
});
