import { describe, expect, it } from "vitest";
import { richLinesOf } from "../format/markdown-lines.js";
import { richHtmlOf, richPlainOf } from "../format/rich-html.js";
import { parseFakeHtml } from "../testing/fake-html.js";
import { splitRichLines } from "./split-rich-lines.js";

function piecesOf(text: string, maxLength?: number) {
  return splitRichLines(richLinesOf(text), maxLength).map((piece) => ({
    html: richHtmlOf(piece),
    plain: richPlainOf(piece),
  }));
}

describe("splitting the agent's lines into Telegram messages", () => {
  it("keeps a reply that fits in one message", () => {
    expect(piecesOf("**one**\n\ntwo").map(({ html }) => html)).toStrictEqual(["<b>one</b>\n\ntwo"]);
  });

  it("cuts a bold line longer than a message, closing and opening its tag again", () => {
    const pieces = piecesOf(`**${"a & b ".repeat(600)}end**`);
    expect(pieces.length).toBeGreaterThan(1);
    expect(Math.max(...pieces.map(({ html }) => html.length))).toBeLessThanOrEqual(4_096);
    expect(pieces.every(({ html }) => /^<b>[^<]*<\/b>$/u.test(html))).toBe(true);
    expect(pieces.every(({ html }) => parseFakeHtml(html).ok)).toBe(true);
    expect(pieces.map(({ plain }) => plain).join("")).toBe(`${"a & b ".repeat(600)}end`);
  });

  it("closes a code block at the end of a message and opens it again in the next", () => {
    const code = Array.from(
      { length: 120 },
      (_, index) => `let v${String(index)} = "<${"x".repeat(40)}>";`,
    );
    const pieces = piecesOf(["Here:", "```ts", ...code, "```", "Done."].join("\n"));
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.html).toMatch(
      /^Here:\n<pre><code class="language-ts">let v0 [^]*<\/code><\/pre>$/u,
    );
    expect(pieces[1]?.html).toMatch(
      /^<pre><code class="language-ts">let v\d+ [^]*<\/code><\/pre>\nDone\.$/u,
    );
    expect(Math.max(...pieces.map(({ html }) => html.length))).toBeLessThanOrEqual(4_096);
    expect(pieces.every(({ html }) => parseFakeHtml(html).ok)).toBe(true);
  });

  it("prefers a paragraph break to a line break once half a message is filled", () => {
    const paragraph = Array.from({ length: 4 }, () => "y".repeat(19)).join("\n");
    const pieces = piecesOf([paragraph, "", paragraph, "", paragraph].join("\n"), 200);
    expect(pieces.map(({ plain }) => plain)).toStrictEqual([
      `${paragraph}\n\n${paragraph}`,
      paragraph,
    ]);
  });

  it("never cuts between the halves of a surrogate pair", () => {
    const pieces = piecesOf(String.fromCodePoint(0x1_d4_00).repeat(3_000));
    expect(pieces.map(({ html }) => html.length)).toStrictEqual([4_096, 1_904]);
  });
});
