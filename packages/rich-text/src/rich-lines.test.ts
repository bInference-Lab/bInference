import { describe, expect, it } from "vitest";
import { isBlankLine, richLinesOf } from "./index.js";

describe("the agent's Markdown as rich lines", () => {
  it("reads bold, code and links into styled runs of one line", () => {
    const [line] = richLinesOf("Send **0.5 BNB** to `0xabc` on [BscScan](https://bscscan.com)");
    expect(line?.runs).toStrictEqual([
      { text: "Send ", marks: [] },
      { text: "0.5 BNB", marks: [{ kind: "bold" }] },
      { text: " to ", marks: [] },
      { text: "0xabc", marks: [{ kind: "code" }] },
      { text: " on ", marks: [] },
      { text: "BscScan", marks: [{ kind: "link", href: "https://bscscan.com" }] },
    ]);
  });

  it("keeps quotes, code blocks and blank lines as blocks of their own", () => {
    const lines = richLinesOf("> Careful\n\n```\nls -l\n```");
    expect(lines.map((line) => line.block.kind)).toStrictEqual(["quote", "text", "code"]);
    expect(lines.map(isBlankLine)).toStrictEqual([false, true, false]);
  });

  it("draws a list item with a bullet and never reads a link that is not on the web", () => {
    const [item, link] = richLinesOf("- one\n[x](javascript:alert(1))");
    expect(item?.runs[0]?.text).toBe("• ");
    expect(link?.runs.some((run) => run.marks.some((mark) => mark.kind === "link"))).toBe(false);
  });
});
