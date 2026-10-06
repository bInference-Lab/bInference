import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./run-command.mjs";

/** Tracked files plus new files git does not ignore, as relative paths with forward slashes. */
export function listRepoFiles(root: string): readonly string[] {
  const listing = runCommand(["git", "ls-files", "-z", "-c", "-o", "--exclude-standard"], {
    cwd: root,
  });
  if (listing.status !== 0) {
    throw new Error(`git ls-files failed in ${root}:\n${listing.output}`);
  }
  return listing.output
    .split("\0")
    .map((file) => file.trim())
    .filter((file) => file.length > 0 && existsSync(join(root, file)));
}
