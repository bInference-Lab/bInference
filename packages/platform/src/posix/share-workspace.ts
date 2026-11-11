import { chmod, chown, mkdir, stat } from "node:fs/promises";
import { BinferenceError } from "@binference/core";

// Read, write and cross for the owner and the group, and new entries keep the folder's group.
const sharedMode = 0o2770;

/**
 * Gives the workspace the group the agent's commands run with and the mode both users write it
 * with, 2770, when it lacks them, as after a restore put it back owner-only (decision 0412). A
 * workspace that is not there is made. Only the folder itself changes, never what it holds.
 * Throws `platform.share_failed` when the folder cannot be made or changed.
 */
export async function shareWorkspace(
  workspace: string,
  group: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  try {
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const now = await stat(workspace);
    if (now.gid !== group) {
      await chown(workspace, now.uid, group);
    }
    if ((now.mode & 0o7777) !== sharedMode) {
      await chmod(workspace, sharedMode);
    }
  } catch (error) {
    throw new BinferenceError({
      code: "platform.share_failed",
      message: `Could not give ${workspace} to the shell's group; check that it is binference's.`,
      cause: error,
      details: { path: workspace },
    });
  }
}
