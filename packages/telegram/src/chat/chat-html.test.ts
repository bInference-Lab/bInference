import { describe, expect, it } from "vitest";
import { parseFakeHtml } from "../testing/fake-html.js";
import { chatHtmlOf } from "./chat-html.js";

function htmlOf(text: string): string {
  return chatHtmlOf(text)
    .map((piece) => piece.html)
    .join("\n---\n");
}

describe("the agent's Markdown as Telegram HTML", () => {
  it("draws bold, italic, struck and inline code", () => {
    expect(htmlOf("You trade in **paper mode**, *not* live. ~~old~~ `0.1 BNB`")).toBe(
      "You trade in <b>paper mode</b>, <i>not</i> live. <s>old</s> <code>0.1 BNB</code>",
    );
    expect(htmlOf("__bold__ and _italic_ and ***both***")).toBe(
      "<b>bold</b> and <i>italic</i> and <b><i>both</i></b>",
    );
  });

  it("nests styles and keeps marks inside code as text", () => {
    expect(htmlOf("**Buy *now* or `**wait**`**")).toBe(
      "<b>Buy <i>now</i> or <code>**wait**</code></b>",
    );
  });

  it("leaves snake case, lone stars and escaped marks as text", () => {
    expect(htmlOf("min_out_amount is 2 * 3 * 4, and \\*kept\\*")).toBe(
      "min_out_amount is 2 * 3 * 4, and *kept*",
    );
  });

  it("closes nothing it did not open when a mark never closes", () => {
    const html = htmlOf("**paper mode and *more `code");
    expect(html).toBe("**paper mode and *more `code");
    expect(parseFakeHtml(html).ok).toBe(true);
  });

  it("draws a fenced code block with its language, and one left open to the end", () => {
    expect(htmlOf("Run:\n```ts\nconst a = 1 < 2;\n```\nDone.")).toBe(
      'Run:\n<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>\nDone.',
    );
    expect(htmlOf("```\n**raw**\n<b>")).toBe("<pre>**raw**\n&lt;b&gt;</pre>");
  });

  it("leaves out a code block's language unless it is letters and digits", () => {
    expect(htmlOf('```c++" onclick="x\nint a;\n```')).toBe("<pre>int a;</pre>");
  });

  it("links an http or https address only", () => {
    expect(htmlOf("See [the docs](https://binference.io/docs?a=1&b=2).")).toBe(
      'See <a href="https://binference.io/docs?a=1&amp;b=2">the docs</a>.',
    );
    expect(htmlOf("[click](javascript:alert(1)) [bot](tg://resolve?domain=x)")).toBe(
      "[click](javascript:alert(1)) [bot](tg://resolve?domain=x)",
    );
    expect(htmlOf('[x](https://a.io/"><b>)')).toBe('[x](https://a.io/"&gt;&lt;b&gt;)');
  });

  it("shows raw HTML and entities from the model as text", () => {
    const html = htmlOf("<script>alert(1)</script> & <b>bold</b> &amp;");
    expect(html).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt; &amp;amp;",
    );
    expect(parseFakeHtml(html)).toMatchObject({
      ok: true,
      value: { text: "<script>alert(1)</script> & <b>bold</b> &amp;", entities: [] },
    });
  });

  it("draws headings as plain lines and quotes as one quote", () => {
    expect(htmlOf("# Plan\n## Step **one**\n> Stay\n> calm")).toBe(
      "Plan\nStep <b>one</b>\n<blockquote>Stay\ncalm</blockquote>",
    );
  });

  it("hides a spoiler until it is tapped, and leaves single pipes as text", () => {
    expect(htmlOf("The answer is ||42||, a | b, ||| c")).toBe(
      "The answer is <tg-spoiler>42</tg-spoiler>, a | b, ||| c",
    );
  });

  it("draws a table as a fixed-width grid in a code block", () => {
    const table =
      "Prices:\n| Token | **Price** |\n|:--|--:|\n| BNB | $600 |\n| CAKE \\| v2 | $2 |\nDone.";
    expect(htmlOf(table)).toBe(
      [
        "Prices:",
        "<pre>| Token     | Price |",
        "| --------- | ----- |",
        "| BNB       | $600  |",
        "| CAKE | v2 | $2    |</pre>",
        "Done.",
      ].join("\n"),
    );
  });

  it("pads wide letters by two cells in a table, and keeps a row of pipes without a delimiter as text", () => {
    const wide = String.fromCodePoint(0x4e2d, 0x6587);
    expect(htmlOf(`| a | b |\n| - | - |\n| ${wide} | x |`)).toBe(
      `<pre>| a    | b   |\n| ---- | --- |\n| ${wide} | x   |</pre>`,
    );
    expect(htmlOf("| a | b |\n| c | d |")).toBe("| a | b |\n| c | d |");
  });

  it("splits a long answer into messages of 4,000 characters at most", () => {
    const pieces = chatHtmlOf(`${"a".repeat(3_000)}\n${"b".repeat(3_000)}`);
    expect(pieces.map((piece) => piece.html.length)).toStrictEqual([3_000, 3_000]);
    const long = chatHtmlOf("c".repeat(4_050));
    expect(long.map((piece) => piece.html.length)).toStrictEqual([4_000, 50]);
  });

  it("draws bullet items as dots and numbered items with their numbers, nested two spaces in", () => {
    expect(htmlOf("- BNB\n  * **CAKE**\n    + XVS\n1. Buy\n2) Hold\n---\nEnd")).toBe(
      "• BNB\n  • <b>CAKE</b>\n    • XVS\n1. Buy\n2) Hold\n\nEnd",
    );
  });

  it("keeps a style across the lines of one paragraph", () => {
    expect(htmlOf("**first\nsecond**")).toBe("<b>first</b>\n<b>second</b>");
  });

  it("shows hidden characters written out, inside styles too", () => {
    expect(htmlOf(`**a${String.fromCodePoint(0x202e)}b**`)).toBe("<b>a\\u{202E}b</b>");
  });

  it("gives plain text without tags or escapes for each message", () => {
    expect(
      chatHtmlOf("**Sold** <all> at [DEX Screener](https://dexscreener.com/bsc)"),
    ).toStrictEqual([
      {
        html: '<b>Sold</b> &lt;all&gt; at <a href="https://dexscreener.com/bsc">DEX Screener</a>',
        plain: "Sold <all> at DEX Screener (https://dexscreener.com/bsc)",
      },
    ]);
  });

  it("gives no message for a text with nothing to show", () => {
    expect(chatHtmlOf("  \n\n ")).toStrictEqual([]);
    expect(chatHtmlOf("---")).toStrictEqual([]);
  });

  it("gives HTML Telegram parses for every Markdown it reads", () => {
    const texts = [
      "**a *b** c*",
      "[**x](https://a.io)**",
      "> **quote\n\nafter**",
      "```\nopen",
      "`a``b`",
      "~~~x~~~ ~~y",
      "[a [b](https://a.io) c](https://b.io)",
      "*a _b* c_",
    ];
    const refused = texts.filter((text) =>
      chatHtmlOf(text).some((piece) => !parseFakeHtml(piece.html).ok),
    );
    expect(refused).toStrictEqual([]);
  });
});
