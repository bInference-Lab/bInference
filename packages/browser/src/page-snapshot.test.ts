import { browserLimits } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { cutAtLine, filterSnapshot } from "./page-snapshot.js";

const tree = [
  "- generic [ref=e1]:",
  '  - heading "Sign in" [level=1] [ref=e2]',
  "  - paragraph [ref=e3]: Welcome back to the harbour.",
  '  - textbox "Email" [ref=e4]',
  '  - button "Continue" [ref=e5]',
  '  - link "Forgot password" [ref=e6]:',
  "    - /url: /reset",
].join("\n");

describe("a page's snapshot", () => {
  it("keeps every line without a filter", () => {
    expect(filterSnapshot(tree, {})).toStrictEqual({ snapshot: tree, cut: false });
  });

  it("keeps the elements a person acts on, and headings", () => {
    expect(filterSnapshot(tree, { interactive: true }).snapshot).toBe(
      [
        '  - heading "Sign in" [level=1] [ref=e2]',
        '  - textbox "Email" [ref=e4]',
        '  - button "Continue" [ref=e5]',
        '  - link "Forgot password" [ref=e6]:',
      ].join("\n"),
    );
  });

  it("keeps the lines holding every word of a query, any case", () => {
    expect(filterSnapshot(tree, { query: "FORGOT link" }).snapshot).toBe(
      '  - link "Forgot password" [ref=e6]:',
    );
  });

  it("cuts a long snapshot at a line's end and says so", () => {
    const long = Array.from(
      { length: 2_000 },
      (_, at) => `- button "B${String(at)}" [ref=e${String(at)}]`,
    ).join("\n");
    const cut = filterSnapshot(long, {});
    expect(cut.cut).toBe(true);
    expect(cut.snapshot.length).toBeLessThanOrEqual(browserLimits.maxSnapshotChars);
    expect(cut.snapshot.endsWith("]")).toBe(true);
  });

  it("cuts one long line where it must", () => {
    expect(cutAtLine("x".repeat(20), 8)).toStrictEqual({ snapshot: "x".repeat(8), cut: true });
  });
});
