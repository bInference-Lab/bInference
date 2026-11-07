import { existsSync } from "node:fs";
import { BinferenceError } from "@binference/core";
import type { CommandLaunch } from "../command-launch.js";
import type { WalledPaths } from "../command-wall-paths.js";
import type { CommandWall, CommandWallState } from "../ports.js";

// macOS ships this sandbox wrapper; a command runs inside the ruleset it is given.
const sandboxExec = "/usr/bin/sandbox-exec";

// The keychain is reached through this service; denying it keeps a command from every entry.
const keychainService = "com.apple.SecurityServer";

// A ruleset is a Scheme-like list, so a path is a double-quoted atom with these escaped.
function quote(path: string): string {
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Allows the machine, then denies reading or writing the walled state folder and reaching the
// keychain, then allows the folders left open inside it. Later rules override earlier ones.
function rulesOf(walled: WalledPaths): string {
  const denies = walled.roots.map(
    (path) => `(deny file-read* file-write* (subpath ${quote(path)}))`,
  );
  const opens = walled.open.map(
    (path) => `(allow file-read* file-write* (subpath ${quote(path)}))`,
  );
  return [
    "(version 1)",
    "(allow default)",
    ...denies,
    `(deny mach-lookup (global-name "${keychainService}"))`,
    ...opens,
  ].join("\n");
}

/**
 * The macOS command wall: a Seatbelt ruleset that allows the machine but denies the state folder,
 * apart from its open folders, and the keychain service, applied through `/usr/bin/sandbox-exec`. It answers `none` only when
 * that wrapper is missing, which no supported macOS lacks.
 */
export function createMacosCommandWall(walled: WalledPaths): CommandWall {
  const state: CommandWallState = existsSync(sandboxExec)
    ? { kind: "held" }
    : { kind: "none", reason: `${sandboxExec} is missing, so a command cannot be walled.` };
  const ruleset = rulesOf(walled);
  return {
    state,
    wrap(launch: CommandLaunch): CommandLaunch {
      if (state.kind === "none") {
        throw new BinferenceError({ code: "platform.no_wall", message: state.reason });
      }
      return { file: sandboxExec, args: ["-p", ruleset, launch.file, ...launch.args] };
    },
  };
}
