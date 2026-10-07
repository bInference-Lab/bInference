import { describe, expect, it } from "vitest";
import { parseFakeHtml } from "./fake-html.js";

// The 400 description of a refused parse; empty for one that passes.
function refusalOf(html: string): string {
  const parsed = parseFakeHtml(html);
  return parsed.ok ? "" : parsed.error;
}

describe("the fake Bot API's HTML parse mode", () => {
  it("shows plain text as it is, with no entities", () => {
    expect(parseFakeHtml("Sell 0.5 BNB")).toStrictEqual({
      ok: true,
      value: { text: "Sell 0.5 BNB", entities: [] },
    });
  });

  it("turns tags into entities at UTF-16 offsets of the shown text", () => {
    const parsed = parseFakeHtml('<b>bold <i>both</i></b> and <a href="https://t.me">a link</a>');
    expect(parsed).toStrictEqual({
      ok: true,
      value: {
        text: "bold both and a link",
        entities: [
          { type: "bold", offset: 0, length: 9 },
          { type: "italic", offset: 5, length: 4 },
          { type: "text_link", offset: 14, length: 6 },
        ],
      },
    });
  });

  it("decodes the entities Telegram knows into the characters they stand for", () => {
    const parsed = parseFakeHtml("&lt;b&gt; &amp; &quot; &#65; &#x42;");
    expect(parsed).toStrictEqual({ ok: true, value: { text: '<b> & " A B', entities: [] } });
  });

  it("makes no entity for an empty element", () => {
    expect(parseFakeHtml("a<b></b>b")).toStrictEqual({
      ok: true,
      value: { text: "ab", entities: [] },
    });
  });

  it.each([
    ["an unknown tag", "<script>x</script>", 'Unsupported start tag "script"'],
    ["a raw token name", "Sell <b> now", 'Can\'t find end tag corresponding to start tag "b"'],
    ["an end tag that closes nothing", "x</b>", 'Unmatched end tag "b"'],
    ["crossed tags", "<b><i>x</b></i>", 'Unmatched end tag "b"'],
    ["a bare less-than sign", "1 < 2", 'Unsupported start tag ""'],
    ["a bare greater-than sign", "2 > 1", 'A bare ">"'],
    ["a bare ampersand", "A & B", 'Unsupported HTML entity or a bare "&"'],
    ["an entity Telegram does not know", "&nbsp;", 'Unsupported HTML entity or a bare "&"'],
    ["a code point past Unicode", "&#x110000;", 'Unsupported HTML entity or a bare "&"'],
  ])("refuses %s", (_name, html, reason) => {
    expect(refusalOf(html)).toContain(`can't parse entities: ${reason}`);
  });
});
