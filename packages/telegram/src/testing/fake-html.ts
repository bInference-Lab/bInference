import { err, ok, type Result } from "@binference/core";

/** A formatting entity Telegram derives from a message's HTML, in UTF-16 offsets. */
export interface FakeEntity {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
}

/** A message's text as a reader sees it, with its formatting entities. */
export interface FormattedText {
  readonly text: string;
  readonly entities: readonly FakeEntity[];
}

interface OpenTag {
  readonly name: string;
  readonly offset: number;
}

/** The parse so far: the tags still open, the entities closed, the length of the text. */
interface ParseState {
  readonly open: OpenTag[];
  readonly entities: FakeEntity[];
  readonly textLength: number;
}

/** One step of the parse: how many characters of HTML it took, and the text they show. */
interface Step {
  readonly taken: number;
  readonly text: string;
}

// The tags Telegram's HTML parse mode accepts, with the entity each one makes.
const entityTypes: Readonly<Record<string, string>> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
  ins: "underline",
  s: "strikethrough",
  strike: "strikethrough",
  del: "strikethrough",
  span: "spoiler",
  "tg-spoiler": "spoiler",
  a: "text_link",
  code: "code",
  pre: "pre",
  blockquote: "blockquote",
  "tg-emoji": "custom_emoji",
};

const namedEntities: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"' };
const tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"<>]*")?)*)\s*>/y;
const entityPattern = /&(?:([a-z]+)|#(\d{1,7})|#x([\da-fA-F]{1,6}));/y;

function refusal(reason: string, at: number): Result<never, string> {
  return err(`Bad Request: can't parse entities: ${reason} at offset ${String(at)}`);
}

function decodeEntity(match: RegExpExecArray): string | undefined {
  const [, name, decimal, hex] = match;
  if (name !== undefined) {
    return namedEntities[name];
  }
  const point = decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number(decimal);
  return point <= 0x10_ffff ? String.fromCodePoint(point) : undefined;
}

function readTag(html: string, at: number, state: ParseState): Result<Step, string> {
  tagPattern.lastIndex = at;
  const match = tagPattern.exec(html);
  const name = match?.[2]?.toLowerCase() ?? "";
  const type = entityTypes[name];
  if (match === null || type === undefined) {
    return refusal(`Unsupported start tag "${name}"`, at);
  }
  const taken = { taken: match[0].length, text: "" };
  if (match[1] !== "/") {
    state.open.push({ name, offset: state.textLength });
    return ok(taken);
  }
  const opened = state.open.pop();
  if (opened?.name !== name) {
    return refusal(`Unmatched end tag "${name}"`, at);
  }
  const length = state.textLength - opened.offset;
  if (length > 0) {
    state.entities.push({ type, offset: opened.offset, length });
  }
  return ok(taken);
}

function readEntity(html: string, at: number): Result<Step, string> {
  entityPattern.lastIndex = at;
  const match = entityPattern.exec(html);
  const decoded = match === null ? undefined : decodeEntity(match);
  if (match === null || decoded === undefined) {
    return refusal('Unsupported HTML entity or a bare "&"', at);
  }
  return ok({ taken: match[0].length, text: decoded });
}

function readAt(html: string, at: number, state: ParseState): Result<Step, string> {
  const character = html.charAt(at);
  if (character === "<") {
    return readTag(html, at, state);
  }
  if (character === "&") {
    return readEntity(html, at);
  }
  return character === ">" ? refusal('A bare ">"', at) : ok({ taken: 1, text: character });
}

/**
 * Parses a message in Telegram's HTML parse mode the way the Bot API does, strictly: only
 * Telegram's tags, balanced; only `&lt;`, `&gt;`, `&amp;`, `&quot;` and numeric entities; no bare
 * `<`, `>` or `&`. Answers the text a reader sees with its entities, or the 400 description.
 */
export function parseFakeHtml(html: string): Result<FormattedText, string> {
  const open: OpenTag[] = [];
  const entities: FakeEntity[] = [];
  let text = "";
  let at = 0;
  while (at < html.length) {
    const step = readAt(html, at, { open, entities, textLength: text.length });
    if (!step.ok) {
      return step;
    }
    text += step.value.text;
    at += step.value.taken;
  }
  const unclosed = open.at(-1);
  if (unclosed !== undefined) {
    return refusal(`Can't find end tag corresponding to start tag "${unclosed.name}"`, at);
  }
  return ok({ text, entities: entities.toSorted((left, right) => left.offset - right.offset) });
}
