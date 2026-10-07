import { rm } from "node:fs/promises";
import { BinferenceError, err, ok, type Result } from "@binference/core";

/**
 * Removes one secret store entry's file. Answers `not_found` when no file is there; throws
 * `platform.file_write_failed` when the file cannot be removed.
 */
export async function removeEntryFile(path: string): Promise<Result<void, "not_found">> {
  try {
    await rm(path);
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return err("not_found");
    }
    throw new BinferenceError({
      code: "platform.file_write_failed",
      message: `Could not remove ${path}; check that it is yours.`,
      cause: error,
      details: { path },
    });
  }
}
