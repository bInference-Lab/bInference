import { stat } from "node:fs/promises";
import { BinferenceError } from "@binference/core";

/**
 * The mode bits of a file or folder, following a link to what it names, or `undefined` when
 * nothing is there. Throws `platform.access_unreadable` when the path cannot be read.
 */
export async function readPathMode(path: string, signal: AbortSignal): Promise<number | undefined> {
  signal.throwIfAborted();
  try {
    return (await stat(path)).mode;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new BinferenceError({
      code: "platform.access_unreadable",
      message: `Could not read who may open ${path}; check that its folder is yours.`,
      cause: error,
      details: { path },
    });
  }
}
