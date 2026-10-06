/**
 * Makes a file or folder readable and writable by its owner only: POSIX modes `0600` and `0700` on
 * macOS and Linux, an access list that names the owner alone on Windows.
 */
export interface FilePermissions {
  /**
   * Restricts an existing folder to its owner. On Windows the files created in it later inherit
   * that access list, so restrict a folder before writing secrets into it.
   */
  restrictFolder(path: string, signal: AbortSignal): Promise<void>;
  /** Restricts an existing file to its owner. */
  restrictFile(path: string, signal: AbortSignal): Promise<void>;
}
