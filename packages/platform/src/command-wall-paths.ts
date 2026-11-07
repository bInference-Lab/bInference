import { realpathSync } from "node:fs";
import { join, relative } from "node:path";
import type { StateFolder } from "./state-folder.js";

/**
 * What a command is walled away from (decision 0378): the whole state folder at every spelling
 * the OS may resolve it to, except the folders left open to commands. Walling the folder whole
 * also covers files binference makes after a command starts, such as a database's journal.
 */
export interface WalledPaths {
  /** The state folder as given and, when it differs, as the OS resolves it. */
  readonly roots: readonly string[];
  /** Folders inside the state folder a command may use: the agent's workspace. */
  readonly open: readonly string[];
}

// The state folder as the OS resolves it, or as given when it does not exist yet.
function realRootOf(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return root;
  }
}

/**
 * The paths a command is walled away from, read from the state folder. The owner's shell may use
 * the rest of the machine; the state folder stays unreachable but for the agent's workspace,
 * because through its tokens, keys, databases, config or socket a command could act as the owner
 * or the engine. A state folder reached through a link is walled at its resolved path too.
 */
export function walledPaths(stateFolder: StateFolder): WalledPaths {
  const { root } = stateFolder;
  const realRoot = realRootOf(root);
  const workspace = relative(root, stateFolder.workspace);
  const roots = realRoot === root ? [root] : [root, realRoot];
  return { roots, open: roots.map((each) => join(each, workspace)) };
}
