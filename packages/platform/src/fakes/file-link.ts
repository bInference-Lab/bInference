import { symlink } from "node:fs/promises";

/**
 * Makes a symbolic link at `path` that leads to `target`, for tests in packages that open no file
 * themselves and must prove a reader follows links to their real place.
 */
export async function createFileLink(target: string, path: string): Promise<void> {
  await symlink(target, path);
}
