import { createHash } from "node:crypto";
import { join } from "node:path";
import { listFolderFiles, readFileBytes } from "@binference/platform";
import { skillLimits } from "./fetch-skill.js";

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The hash of a skill's folder as it is now (decision 0408): the SHA-256 of one line per file,
 * `<path> <SHA-256 of its bytes>`, in path order, so any change to any file of the skill, a
 * support file too, gives another hash. A folder of more than 200 files or 2 MiB, or one whose
 * files change while it is read, has none: such a skill never loads from a workspace.
 */
export async function skillFolderHash(
  folder: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const paths = await listFolderFiles(folder, signal);
  if (paths.length === 0 || paths.length > skillLimits.files) {
    return undefined;
  }
  const lines: string[] = [];
  let room = skillLimits.bytes;
  for (const path of paths) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file after another bounds the bytes read
    const read = await readFileBytes(join(folder, path), { maxBytes: room, signal });
    if (!read.ok) {
      return undefined;
    }
    room -= read.value.byteLength;
    lines.push(`${path} ${sha256(read.value)}\n`);
  }
  return sha256(lines.join(""));
}
