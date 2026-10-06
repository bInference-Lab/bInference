import { BinferenceError } from "@binference/core";
import type { FilePermissions } from "../ports.js";
import { runCommand, type RunProgram } from "../run-command.js";
import { ownerSidOf, whoamiUserArgs } from "./owner-sid.js";

/** What the Windows adapter runs its programs with. */
export interface Win32FilePermissionsOptions {
  /** `runCommand` when left out; tests pass a recorder. */
  readonly run?: RunProgram;
}

const systemSid = "S-1-5-18";

async function readOwnerSid(run: RunProgram, signal: AbortSignal): Promise<string> {
  return ownerSidOf(await run("whoami", whoamiUserArgs, signal));
}

/**
 * Owner-only files and folders on Windows through icacls: inherited access goes, and the current
 * account and SYSTEM get full control. SYSTEM stays because Windows itself runs as it, as root does
 * on macOS and Linux. A folder's grants pass to the files made in it. Explicit grants that another
 * tool added to an existing path stay; binference never adds one.
 */
export function createWin32FilePermissions(
  options: Win32FilePermissionsOptions = {},
): FilePermissions {
  const run = options.run ?? runCommand;
  let ownerSid: Promise<string> | undefined;
  const owner = async (signal: AbortSignal): Promise<string> => {
    ownerSid ??= readOwnerSid(run, signal);
    try {
      return await ownerSid;
    } catch (error) {
      ownerSid = undefined;
      throw error;
    }
  };
  const restrict = async (path: string, grant: string, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    const sid = await owner(signal);
    try {
      // One call that only narrows access: a reset first would hand the parent's access to the
      // path for a moment, and to every file below it that inherits from it.
      await run(
        "icacls",
        [
          path,
          "/inheritance:r",
          "/grant:r",
          `*${sid}:${grant}`,
          "/grant:r",
          `*${systemSid}:${grant}`,
        ],
        signal,
      );
    } catch (error) {
      throw new BinferenceError({
        code: "platform.restrict_failed",
        message: `Could not make ${path} owner-only; check that it exists and belongs to you.`,
        cause: error,
        details: { path },
      });
    }
  };
  return {
    restrictFolder: async (path, signal) => restrict(path, "(OI)(CI)(F)", signal),
    restrictFile: async (path, signal) => restrict(path, "(F)", signal),
  };
}
