import type { FileAccess } from "../ports.js";
import { readPathMode } from "../read-path-mode.js";

/**
 * Who can reach a path on Windows: `unknown` for a path that exists. Its access list names
 * accounts in the system's language unless read by security id, and that read needs PowerShell,
 * which takes seconds; `FilePermissions` restricts a path without reading it first.
 */
export function createWin32FileAccess(): FileAccess {
  return {
    async read(path, signal) {
      return (await readPathMode(path, signal)) === undefined ? "missing" : "unknown";
    },
  };
}
