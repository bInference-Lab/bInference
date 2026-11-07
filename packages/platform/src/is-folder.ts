import { statSync } from "node:fs";

/**
 * Whether a folder is at `path`, following links. A command's folder is checked this way right
 * before it starts, so the answer is synchronous like the start.
 */
export function isFolder(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
