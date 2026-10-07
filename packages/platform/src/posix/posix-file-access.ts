import type { FileAccess } from "../ports.js";
import { readPathMode } from "../read-path-mode.js";

/** Who can reach a path on macOS and Linux: other accounts can when a group or other bit is set. */
export function createPosixFileAccess(): FileAccess {
  return {
    async read(path, signal) {
      const mode = await readPathMode(path, signal);
      if (mode === undefined) {
        return "missing";
      }
      return (mode & 0o077) === 0 ? "owner_only" : "open";
    },
  };
}
