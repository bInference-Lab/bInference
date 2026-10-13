import { join } from "node:path";
import { BinferenceError, err, type Id, ok, type Result } from "@binference/core";
import { listFolderFiles, readTextFile } from "@binference/platform";
import { lintSkill } from "@binference/plugin-sdk";
import type { ShelfSkill, SkillShelf } from "./skill-shelf.js";

/** One file of a skill, as `skill/read` answers it. */
export interface SkillFileText {
  readonly skill: ShelfSkill;
  /** The file's path inside the skill's folder. */
  readonly file: string;
  readonly text: string;
}

/** Why a skill file was not read: no such skill or file, a path outside it, or a lint finding. */
export type SkillReadRefusal = "not_found" | "bad_path" | "refused";

/** The most a file `open_skill` reads: a playbook's page, not a data set. */
const maxSkillFileBytes: number = 256 * 1024;

// A path inside the folder: parts of letters, digits, `._-`, none empty or starting with a dot,
// so `.`, `..` and hidden files never match.
const insidePath = /^[A-Za-z0-9_-][\w.-]*(?:\/[A-Za-z0-9_-][\w.-]*)*$/;

/** Whether a path names a file inside a skill's folder and nothing above it. */
export function isInsidePath(file: string): boolean {
  return file.length <= 256 && insidePath.test(file);
}

// A text the agent may read: UTF-8 with no NUL, at most 256 KiB, and no lint finding.
function isServable(text: string): boolean {
  return (
    !text.includes("\u0000") &&
    !text.includes("\uFFFD") &&
    Buffer.byteLength(text, "utf8") <= maxSkillFileBytes &&
    lintSkill(text).length === 0
  );
}

// The file's text, or why it gives none; a file past 1 MiB is refused before it is read.
async function servedText(
  path: string,
  signal: AbortSignal,
): Promise<Result<string, "not_found" | "refused">> {
  try {
    const read = await readTextFile(path, signal);
    if (!read.ok) {
      return read;
    }
    return isServable(read.value) ? read : err("refused");
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "platform.file_too_large") {
      return err("refused");
    }
    throw error;
  }
}

/**
 * Reads one file of a skill the agent's index holds (decision 0207): `SKILL.md` unless `file`
 * names another. A skill the index does not hold, or a file its folder does not list, is
 * `not_found`; the folder's listing never holds a link, so a link is never followed. A path with
 * an empty, `.` or `..` part or a leading dot is `bad_path`. A file over 256 KiB, one that is not
 * UTF-8 text, or one with a lint finding is `refused`.
 */
export async function readSkillText(
  shelf: SkillShelf,
  request: { readonly agent: Id<"agt">; readonly skill: string; readonly file?: string },
  signal: AbortSignal,
): Promise<Result<SkillFileText, SkillReadRefusal>> {
  const file = request.file ?? "SKILL.md";
  if (!isInsidePath(file)) {
    return err("bad_path");
  }
  const skill = (await shelf.list(request.agent, signal)).find(
    ({ name }) => name === request.skill,
  );
  if (skill === undefined || !(await listFolderFiles(skill.folder, signal)).includes(file)) {
    return err("not_found");
  }
  const text = await servedText(join(skill.folder, file), signal);
  return text.ok ? ok({ skill, file, text: text.value }) : text;
}
