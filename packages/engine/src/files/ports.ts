import type { Result } from "@binference/core";
import type { FileCall, ReadFile } from "./file-records.js";

/** Why the machine's files refused a call (decision 0386). */
export type FileRefusal =
  | "not_found"
  | "walled"
  | "outside_workspace"
  | "too_large"
  | "is_folder"
  | "unreadable"
  | "unwritable"
  | "exists"
  | "skill_folder";

/**
 * The agent's files on the engine's machine (decision 0386). A path is absolute, `~/` under the
 * owner's home folder, or relative to the agent's workspace. binference's own folder, its
 * workspace aside, is walled off; with `workspaceOnly`, any path outside the workspace is
 * refused. A write or a removal inside a workspace skills folder is `skill_folder`: a skill changes
 * only through a proposal the owner applies (decision 0408). Each call answers the file's absolute
 * path.
 */
export interface MachineFiles {
  /** Reads a regular file whole, refusing one over `maxBytes` as `too_large`. */
  read(
    path: string,
    options: FileCall & { readonly maxBytes: number },
  ): Promise<Result<ReadFile, FileRefusal>>;
  /**
   * Writes a file whole, creating its missing folders, so that no reader sees part of it; a file
   * that was there keeps its permissions. With `createOnly`, a path that holds a file is `exists`.
   */
  write(
    path: string,
    bytes: Readonly<Uint8Array>,
    options: FileCall & { readonly createOnly?: boolean },
  ): Promise<Result<string, FileRefusal>>;
  /** Removes a file; a link is removed itself, never what it leads to. */
  remove(path: string, options: FileCall): Promise<Result<string, FileRefusal>>;
}
