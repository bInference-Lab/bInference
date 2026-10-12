// A page as the model reads it: its title and its text, with no markup. A page is outside content,
// so this only shapes it; nothing in it is followed. The page is read in one pass with `indexOf`,
// never with a pattern that can backtrack, so no page can stall the runtime: its time grows with
// its size alone.

/** What a page says, as text. */
export interface PageText {
  readonly title?: string;
  readonly text: string;
}

// Elements whose content no reader sees.
const hiddenElements: ReadonlySet<string> = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "iframe",
  "object",
  "title",
]);

// Elements that start a new line where they open or close.
const blockElements: ReadonlySet<string> = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "tr",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "blockquote",
  "pre",
  "hr",
  "dt",
  "dd",
  "figcaption",
]);

const namedEntities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function codePoint(value: number): string {
  const isScalar = value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff);
  return isScalar ? String.fromCodePoint(value) : "�";
}

function entity(whole: string, name: string): string {
  if (name.startsWith("#x") || name.startsWith("#X")) {
    return codePoint(Number.parseInt(name.slice(2), 16));
  }
  if (name.startsWith("#")) {
    return codePoint(Number.parseInt(name.slice(1), 10));
  }
  return namedEntities[name.toLowerCase()] ?? whole;
}

/** Text with its HTML character references read: the common names and every number. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{1,8});/gi, entity);
}

// Spaces within a line collapse to one; blank lines collapse to one.
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[\t\f\v  ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The element a tag at `open` names, in lower case, and whether it closes one.
function tagAt(lower: string, open: number): { readonly name: string; readonly closes: boolean } {
  const closes = lower.charAt(open + 1) === "/";
  const start = open + (closes ? 2 : 1);
  let end = start;
  while (end < lower.length && /[a-z\d]/.test(lower.charAt(end))) {
    end += 1;
  }
  return { name: lower.slice(start, end), closes };
}

// Where the text after an element's end tag starts; the end of the page when it has none.
function afterEndTag(lower: string, name: string, from: number): number {
  const end = lower.indexOf(`</${name}`, from);
  const close = end < 0 ? -1 : lower.indexOf(">", end);
  return close < 0 ? lower.length : close + 1;
}

function titleOf(html: string, lower: string): string | undefined {
  const open = lower.indexOf("<title");
  const start = open < 0 ? -1 : lower.indexOf(">", open);
  const end = start < 0 ? -1 : lower.indexOf("</title", start);
  const title =
    end < 0 ? "" : tidy(decodeEntities(html.slice(start + 1, end))).replaceAll("\n", " ");
  return title === "" ? undefined : title;
}

// The page's text pieces, with a line break for each block element's tag.
function textPieces(html: string, lower: string): readonly string[] {
  const pieces: string[] = [];
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    pieces.push(html.slice(at, open < 0 ? html.length : open));
    const close = open < 0 ? -1 : html.indexOf(">", open + 1);
    if (close < 0) {
      break;
    }
    if (lower.startsWith("<!--", open)) {
      const end = lower.indexOf("-->", open + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    const tag = tagAt(lower, open);
    at = close + 1;
    if (!tag.closes && hiddenElements.has(tag.name)) {
      at = afterEndTag(lower, tag.name, at);
    } else if (blockElements.has(tag.name)) {
      pieces.push("\n");
    }
  }
  return pieces;
}

// ASCII letters in lower case and nothing else, so every index still points at the same character:
// `toLowerCase` can lengthen a string, as it does for U+0130.
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** An HTML page's title and visible text: scripts, styles and markup removed, blocks on lines. */
export function htmlText(html: string): PageText {
  const lower = asciiLower(html);
  const title = titleOf(html, lower);
  const text = tidy(decodeEntities(textPieces(html, lower).join("")));
  return title === undefined ? { text } : { title, text };
}

// The charset a page's own markup names in its first bytes, as the HTML standard reads them.
function metaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1_024));
  return /<meta[^>]{0,200}charset\s*=\s*["']?([\w-]{1,40})/i.exec(head)?.[1];
}

function decoderFor(label: string | undefined): TextDecoder {
  try {
    return new TextDecoder(label ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

/**
 * The text of a page's bytes in the charset its `content-type` names, else the one its markup
 * names in its first 1,024 bytes, else UTF-8; a charset the runtime does not know reads as UTF-8.
 * A character cut at the end of the bytes reads as a replacement character.
 */
export function decodePage(bytes: Uint8Array, contentType: string): string {
  const declared = /charset\s*=\s*["']?([\w-]{1,40})/i.exec(contentType)?.[1];
  return decoderFor(declared ?? metaCharset(bytes)).decode(bytes);
}
