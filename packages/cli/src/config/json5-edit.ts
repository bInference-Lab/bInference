import { stableJson } from "@binference/core";
import { readConfigText } from "./config-text.js";
import type { JsonValue } from "./json-value.schema.js";
import { json5Inline, json5Key } from "./json5-inline.js";
import { type Json5Value, readJson5Spans } from "./json5-spans.js";
import { applyEdits, type ConfigEdit } from "./migrations/config-edit.js";

// Edits config.json5 as text: each edit changes the bytes of one value, adds one member, or
// removes one member's lines, and leaves every other byte, comments and order included, as it was.

/** An object's span, the kind each edit walks through. */
type ObjectSpan = Extract<Json5Value, { kind: "object" }>;

const lineBreak = /\r\n|[\n\r\u2028\u2029]/;

// The value a path below a missing key needs: objects down to the value.
function nested(path: readonly string[], value: JsonValue): JsonValue {
  return path.toReversed().reduce<JsonValue>((inner, key) => ({ [key]: inner }), value);
}

function spliced(text: string, at: { readonly start: number; readonly end: number }, by: string) {
  return `${text.slice(0, at.start)}${by}${text.slice(at.end)}`;
}

// A new member goes first in its object: on a line of its own, indented as the first member,
// when the members start on a new line; else on the brace's line.
function inserted(text: string, object: ObjectSpan, member: string): string {
  const [first] = object.members;
  const at = { start: object.openEnd, end: object.openEnd };
  if (first === undefined) {
    return spliced(text, at, ` ${member} `);
  }
  const between = text.slice(object.openEnd, first.keyStart);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /[^\S\r\n]*$/.exec(between)?.[0] ?? "";
  return spliced(
    text,
    at,
    lineBreak.test(between) ? `${newline}${indent}${member},` : ` ${member},`,
  );
}

function setIn(
  text: string,
  object: ObjectSpan,
  edit: { readonly path: readonly string[]; readonly value: JsonValue },
): string | undefined {
  const [key, ...rest] = edit.path;
  if (key === undefined) {
    return undefined;
  }
  const member = object.members.findLast((each) => each.key === key);
  if (member === undefined) {
    return inserted(text, object, `${json5Key(key)}: ${json5Inline(nested(rest, edit.value))}`);
  }
  if (rest.length === 0) {
    return spliced(text, member.value, json5Inline(edit.value));
  }
  return member.value.kind === "object"
    ? setIn(text, member.value, { path: rest, value: edit.value })
    : undefined;
}

// The span a removed member takes: its whole lines, with a comment at the end of its last line,
// when nothing else shares them; else the member and its comma alone.
function removedSpan(text: string, start: number, end: number) {
  const lineStart =
    Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf("\r", start - 1)) + 1;
  const rest = text.slice(end);
  const breakAt = rest.search(lineBreak);
  const lineEnd = breakAt === -1 ? text.length : end + breakAt;
  const tail = text.slice(end, lineEnd).trim();
  const isOwnLines =
    text.slice(lineStart, start).trim() === "" && (tail === "" || tail.startsWith("//"));
  if (!isOwnLines) {
    return { start, end: end + (/^[^\S\r\n]*/.exec(rest)?.[0].length ?? 0) };
  }
  const breakLength = /^(?:\r\n|[\n\r\u2028\u2029])/.exec(text.slice(lineEnd))?.[0].length ?? 0;
  return { start: lineStart, end: lineEnd + breakLength };
}

function removeIn(text: string, object: ObjectSpan, path: readonly string[]): string | undefined {
  const [key, ...rest] = path;
  const member =
    key === undefined ? undefined : object.members.findLast((each) => each.key === key);
  if (member === undefined) {
    return text;
  }
  if (rest.length > 0) {
    return member.value.kind === "object" ? removeIn(text, member.value, rest) : text;
  }
  return spliced(text, removedSpan(text, member.keyStart, member.commaEnd ?? member.value.end), "");
}

function applied(text: string, edit: ConfigEdit): string | undefined {
  const root = readJson5Spans(text);
  if (root?.kind !== "object") {
    return undefined;
  }
  if (edit.kind === "set") {
    return setIn(text, root, edit);
  }
  return edit.kind === "remove" ? removeIn(text, root, edit.path) : undefined;
}

/**
 * The text of `config.json5` with the edits made in place, and every other byte as it was:
 * comments, key order and formatting stay. A `set` replaces a value's bytes, or adds a missing
 * key first in its object, indented as the object's first key; a `remove` takes a key's whole
 * lines, with a comment at the end of its last line, when it has lines of its own. A comment
 * above a removed key stays. `undefined` when the text is no config file this editor can read, an
 * edit walks through a value that is not an object or is a `move`, or the result would read as
 * anything but the file with exactly those edits, so nothing is written then.
 */
export function editJson5Text(text: string, edits: readonly ConfigEdit[]): string | undefined {
  const before = readConfigText(text);
  if (!before.ok) {
    return undefined;
  }
  const edited = edits.reduce<string | undefined>(
    (current, edit) => (current === undefined ? undefined : applied(current, edit)),
    text,
  );
  const after = edited === undefined ? undefined : readConfigText(edited);
  const expected = applyEdits(before.value, edits);
  return after?.ok === true && stableJson(after.value) === stableJson(expected)
    ? edited
    : undefined;
}
