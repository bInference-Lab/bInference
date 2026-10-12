import type { WorkspaceFiles } from "@binference/core";
import { createWorkspaceFolder, type Platform } from "@binference/platform";

/** The agents' workspace files in the state folder's `workspace/`, one owner-only folder each. */
export function stateWorkspace(
  platform: Pick<Platform, "stateFolder" | "permissions">,
): WorkspaceFiles {
  return createWorkspaceFolder({
    root: platform.stateFolder.workspace,
    permissions: platform.permissions,
  });
}
