import { describe, expect, it } from "vitest";
import { decodeEntities, decodePage, htmlText } from "./page-text.js";
import { discardBody, readBodyStart } from "./read-body.js";

const encoder = new TextEncoder();

async function* piecesOf(...pieces: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const piece of pieces) {
    yield encoder.encode(piece);
  }
}

describe("htmlText", () => {
  it("keeps the title and the visible text, each block on its own line", () => {
    const html =
      "<!doctype html><HTML><head><title> A  &lt;page&gt; </title><style>p{}</style></head>" +
      "<body><!-- note --><nav>Home</nav><SCRIPT>alert(1)</SCRIPT><p>One&nbsp;two</p>" +
      "<ul><li>first</li><li>second &#x2713; &#169;</li></ul><noscript>Turn it on</noscript></body></HTML>";
    expect(htmlText(html)).toStrictEqual({
      title: "A <page>",
      text: "Home\n\nOne two\n\nfirst\n\nsecond ✓ ©",
    });
  });

  it("drops the rest of a page after an element that never closes", () => {
    expect(htmlText("<p>seen</p><script>never closed <p>hidden")).toStrictEqual({ text: "seen" });
    expect(htmlText("text <unclosed tag")).toStrictEqual({ text: "text" });
    expect(htmlText("before <!-- an open comment")).toStrictEqual({ text: "before" });
  });

  it("reads a page built to stall a pattern in time that grows with its size", () => {
    const hostile = "<script".repeat(100_000) + "<".repeat(200_000) + "&a".repeat(100_000);
    expect(htmlText(hostile).text).toBe("");
  });

  it("keeps a character whose lower case is longer in its place", () => {
    expect(htmlText("<p>İstanbul</p><p>two</p>").text).toBe("İstanbul\n\ntwo");
  });
});

describe("decodeEntities", () => {
  it("reads names and numbers, and leaves what it does not know", () => {
    expect(decodeEntities("&amp;&quot;&apos;&#65;&#x42;&unknown;&#0;&#xD800;")).toBe(
      "&\"'AB&unknown;��",
    );
  });
});

describe("decodePage", () => {
  it("reads the charset the content type names, else the page's own, else UTF-8", () => {
    const latin = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
    expect(decodePage(latin, "text/plain; charset=ISO-8859-1")).toBe("café");
    const marked = Uint8Array.from([...encoder.encode('<meta charset="latin1">'), 0xe9]);
    expect(decodePage(marked, "text/html")).toBe('<meta charset="latin1">é');
    expect(decodePage(encoder.encode("café"), "text/html; charset=no-such-set")).toBe("café");
  });
});

describe("readBodyStart", () => {
  it("reads a body whole when it fits, and cuts it at the cap when it does not", async () => {
    await expect(readBodyStart(piecesOf("ab", "cd"), 4)).resolves.toStrictEqual({
      bytes: encoder.encode("abcd"),
      cut: false,
    });
    await expect(readBodyStart(piecesOf("ab", "cd", "e"), 4)).resolves.toStrictEqual({
      bytes: encoder.encode("abcd"),
      cut: true,
    });
    await expect(readBodyStart(piecesOf("abc", "def"), 4)).resolves.toStrictEqual({
      bytes: encoder.encode("abcd"),
      cut: true,
    });
  });

  it("closes a body it will not read", async () => {
    const closed = { done: false };
    async function* body(): AsyncGenerator<Uint8Array> {
      try {
        yield encoder.encode("never read");
      } finally {
        closed.done = true;
      }
    }
    const pieces = body();
    await pieces.next();
    await discardBody(pieces);
    expect(closed.done).toBe(true);
  });
});
