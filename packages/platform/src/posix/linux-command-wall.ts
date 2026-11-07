import { existsSync } from "node:fs";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import type { CommandLaunch } from "../command-launch.js";
import type { WalledPaths } from "../command-wall-paths.js";
import type { CommandWall, CommandWallState } from "../ports.js";

// Bubblewrap confines a command to a view of the file tree it is given; a command runs inside it.
// Distributions install it in these folders; the wall reads no environment (platform rule).
const bwrapDirs = ["/usr/bin", "/bin", "/usr/local/bin"] as const;

function bwrapPath(): string | undefined {
  return bwrapDirs.map((dir) => join(dir, "bwrap")).find((path) => existsSync(path));
}

// The command sees the whole tree, then an empty folder over the state folder, then the folders
// left open bound back over it, so nothing else of the state folder exists for it, even a file
// binference makes later.
function argsOf(walled: WalledPaths): readonly string[] {
  const covers = walled.roots.flatMap((path) => ["--tmpfs", path]);
  const opens = walled.open.flatMap((path) => ["--bind-try", path, path]);
  return ["--dev-bind", "/", "/", ...covers, ...opens, "--"];
}

/**
 * The Linux command wall: `bwrap` (bubblewrap) binds the whole file tree, then covers the state
 * folder with an empty temporary file system and binds its open folders back, so the command
 * reaches the machine but none of binference's secrets. It answers `none` when `bwrap` is
 * not on `PATH`, since there is then no mechanism to wall a command.
 */
export function createLinuxCommandWall(walled: WalledPaths): CommandWall {
  const path = bwrapPath();
  const state: CommandWallState =
    path === undefined
      ? {
          kind: "none",
          reason: "bwrap (bubblewrap) is not installed, so a command cannot be walled.",
        }
      : { kind: "held" };
  const base = path === undefined ? [] : argsOf(walled);
  return {
    state,
    wrap(launch: CommandLaunch): CommandLaunch {
      if (path === undefined) {
        throw new BinferenceError({
          code: "platform.no_wall",
          message: state.kind === "none" ? state.reason : "",
        });
      }
      return { file: path, args: [...base, launch.file, ...launch.args] };
    },
  };
}
