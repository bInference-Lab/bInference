import { realpath } from "node:fs/promises";
import { BinferenceError } from "@binference/core";

/**
 * The path of a file with every link on the way resolved, as Node's permission model lets a
 * program read only the file it was started with, never through a link such as pnpm's
 * `node_modules`. Throws `platform.path_unresolved` when nothing is at `path`.
 */
export async function realFilePath(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  try {
    return await realpath(path);
  } catch (error) {
    throw new BinferenceError({
      code: "platform.path_unresolved",
      message: `${path} does not exist, so it has no real path.`,
      cause: error,
      details: { path },
    });
  }
}
