import { err, ok, type Result } from "@binference/core";
import { parseDocument } from "yaml";
import { readSkillFile } from "../skills/skill-file.js";

const byteOrderMark = String.fromCodePoint(0xfeff);

// The block between a first line of `---` and the next line of `---`, and what follows it.
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A `SKILL.md` cut in two: its frontmatter's YAML and the body after it. */
interface SkillParts {
  readonly yaml: string;
  readonly body: string;
}

function partsOf(text: string): SkillParts | undefined {
  const plain = text.startsWith(byteOrderMark) ? text.slice(1) : text;
  const found = frontmatter.exec(plain);
  if (found?.[1] === undefined) {
    return undefined;
  }
  return { yaml: found[1], body: plain.slice(found[0].length).replace(/^\r?\n/, "") };
}

function withEndOfLine(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function joined(yaml: string, body: string): string {
  return `---\n${withEndOfLine(yaml)}---\n\n${withEndOfLine(body)}`;
}

/** The body of a skill's `SKILL.md`, after its frontmatter; the whole text when it has none. */
export function bodyOf(text: string): string {
  return partsOf(text)?.body ?? text;
}

/** Why a proposed text is not a skill: no frontmatter, or one whose name is another. */
export type SkillTextProblem = "invalid";

// The text, once its frontmatter reads as a skill of this name.
function checked(text: string, name: string): Result<string, SkillTextProblem> {
  const front = readSkillFile(text);
  return front.ok && front.value.name === name ? ok(text) : err("invalid");
}

/**
 * A new skill's `SKILL.md` (decision 0408): a frontmatter binference writes with the `name` and
 * the `description` as a quoted YAML string, then the body.
 */
export function newSkillText(
  name: string,
  parts: { readonly description: string; readonly body: string },
): Result<string, SkillTextProblem> {
  const yaml = `name: ${name}\ndescription: ${JSON.stringify(parts.description)}`;
  return checked(joined(yaml, parts.body), name);
}

/**
 * A skill's `SKILL.md` with a new body, a new description, or both: its other frontmatter fields
 * are kept as written, and a missing part stays as it was.
 */
export function changedSkillText(
  current: string,
  change: { readonly name: string; readonly description?: string; readonly body?: string },
): Result<string, SkillTextProblem> {
  const parts = partsOf(current);
  if (parts === undefined) {
    return err("invalid");
  }
  const document = parseDocument(parts.yaml);
  if (change.description !== undefined) {
    document.set("description", change.description);
  }
  const yaml = change.description === undefined ? parts.yaml : document.toString();
  return checked(joined(yaml, change.body ?? parts.body), change.name);
}

/**
 * The text with `find` replaced by `replace`, when `find` appears in it exactly once; else why
 * not: `unmatched` for none or more than one.
 */
export function patchedText(
  current: string,
  edit: { readonly find: string; readonly replace: string },
): Result<string, "unmatched"> {
  const first = current.indexOf(edit.find);
  if (first === -1 || current.includes(edit.find, first + 1)) {
    return err("unmatched");
  }
  return ok(`${current.slice(0, first)}${edit.replace}${current.slice(first + edit.find.length)}`);
}

/** The description a `SKILL.md`'s frontmatter gives, on one line, or `undefined`. */
export function descriptionOf(text: string): string | undefined {
  const front = readSkillFile(text);
  return front.ok ? front.value.description : undefined;
}
