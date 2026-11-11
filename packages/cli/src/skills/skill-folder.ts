import { isAbsolute, join, relative } from "node:path";
import { err, ok, type Result } from "@binference/core";
import { readJudgedFile, realPathOf } from "@binference/platform";

/**
 * A skill's folder (decision 0410): its path, and its real path reached from its place's root with
 * no link on the way, so a folder or a file that became a link reads nothing.
 */
export interface SkillFolder {
  readonly folder: string;
  readonly realFolder: string;
}

/** Why a skill's file gave no bytes: nothing there, it led elsewhere, too big, or unreadable. */
export type SkillFileRefusal = "not_found" | "changed" | "too_large" | "unreadable";

/**
 * The skill folder `inner` below `root`, a folder no agent can change, such as the state folder's
 * workspace: its real path is the root's real path with `inner` after it, never `inner` resolved.
 */
export async function skillFolderUnder(
  root: string,
  inner: string,
  signal: AbortSignal,
): Promise<SkillFolder> {
  const realRoot = (await realPathOf(root, signal)) ?? root;
  return { folder: join(root, inner), realFolder: join(realRoot, inner) };
}

function isInside(folder: string, path: string): boolean {
  const between = relative(folder, path);
  return between !== "" && !between.startsWith("..") && !isAbsolute(between);
}

/**
 * Reads one file of a skill's folder whole, at most `maxBytes`, only when the handle that reads it
 * holds a file whose real path is inside the folder's real path. A folder's listing never holds a
 * link or a folder where a file is read, so one found there is a file that changed: `changed`.
 */
export async function readSkillBytes(
  skill: SkillFolder,
  file: string,
  options: { readonly maxBytes: number; readonly signal: AbortSignal },
): Promise<Result<Uint8Array, SkillFileRefusal>> {
  const read = await readJudgedFile(join(skill.folder, file), {
    ...options,
    judge: (realPath) => (isInside(skill.realFolder, realPath) ? undefined : "outside"),
  });
  if (read.kind === "read") {
    return ok(read.bytes);
  }
  return err(read.kind === "refused" || read.kind === "is_folder" ? "changed" : read.kind);
}

/** The most bytes a skill's text file takes, as the config and secret files' reader does. */
const maxSkillTextBytes = 1_048_576;

/** Reads one text file of a skill's folder as {@link readSkillBytes} does, as UTF-8. */
export async function readSkillTextFile(
  skill: SkillFolder,
  file: string,
  signal: AbortSignal,
): Promise<Result<string, SkillFileRefusal>> {
  const read = await readSkillBytes(skill, file, { maxBytes: maxSkillTextBytes, signal });
  return read.ok ? ok(Buffer.from(read.value).toString("utf8")) : read;
}
