import { existsSync } from "node:fs";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import type { CommandLaunch } from "../command-launch.js";
import type { WalledPaths } from "../command-wall-paths.js";
import type { CommandWall, CommandWallState } from "../ports.js";
import { runCommandWithin, type RunToExit } from "../run-command.js";

// Bubblewrap confines a command to a view of the file tree it is given; a command runs inside it.
// Distributions install it in these folders; the wall reads no environment (platform rule).
const bwrapDirs = ["/usr/bin", "/bin", "/usr/local/bin"] as const;

// The command a check runs behind the wall: the shell every Linux has, doing nothing.
const noOp = ["/bin/sh", "-c", ":"] as const;

// A check's share of time: bubblewrap answers in milliseconds, or refuses at once.
const checkMs = 5_000;

// What a refusal keeps of bubblewrap's words, such as "Creating new namespace failed".
const reasonChars = 200;

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

const missing: CommandWallState = {
  kind: "none",
  cause: "missing",
  reason: "bwrap (bubblewrap) is not installed, so a command cannot be walled.",
};

function refused(said: string): CommandWallState {
  const words = said.trim().split("\n")[0]?.slice(0, reasonChars) ?? "";
  return {
    kind: "none",
    cause: "refused",
    reason:
      "bwrap (bubblewrap) could not run a command here, as on a machine that refuses it " +
      `unprivileged user namespaces${words === "" ? "" : `: ${words}`}.`,
  };
}

/** Where the Linux wall finds bubblewrap and how it runs its check; tests pass their own. */
export interface LinuxCommandWallOptions {
  /** The path of `bwrap`, looked for again at each check until the wall holds. */
  readonly findBwrap?: () => string | undefined;
  /** Runs a program to its end; `runCommandWithin` with a 5 second limit when left out. */
  readonly run?: RunToExit;
}

const runWithin: RunToExit = async (file, args, signal) =>
  runCommandWithin(file, args, { signal, timeoutMs: checkMs });

// Runs the no-op command through bubblewrap with the wall's own arguments; `held` only when it
// ran and ended well.
async function tried(
  bwrap: string,
  wall: { readonly base: readonly string[]; readonly run: RunToExit },
  signal: AbortSignal,
): Promise<CommandWallState> {
  try {
    const exit = await wall.run(bwrap, [...wall.base, ...noOp], signal);
    return exit.exitCode === 0 ? { kind: "held", by: "bubblewrap" } : refused(exit.stderr);
  } catch (error) {
    signal.throwIfAborted();
    return refused(error instanceof Error ? error.message : "");
  }
}

/**
 * The Linux command wall: `bwrap` (bubblewrap) binds the whole file tree, then covers the state
 * folder with an empty temporary file system and binds its open folders back, so the command
 * reaches the machine but none of binference's secrets. It holds only once a check ran a command
 * that does nothing through `bwrap` with those arguments: before that it answers `none`, with
 * the cause `untried`, `missing` while `bwrap` is not installed, and `refused` while the machine
 * refuses it, as a container under Docker's default seccomp profile or a machine with
 * unprivileged user namespaces off does.
 */
export function createLinuxCommandWall(
  walled: WalledPaths,
  options: LinuxCommandWallOptions = {},
): CommandWall {
  const findBwrap = options.findBwrap ?? bwrapPath;
  const run = options.run ?? runWithin;
  const base = argsOf(walled);
  let held: string | undefined;
  let state: CommandWallState =
    findBwrap() === undefined
      ? missing
      : { kind: "none", cause: "untried", reason: "bubblewrap has not been tried yet." };
  return {
    get state() {
      return state;
    },
    async check(signal: AbortSignal): Promise<CommandWallState> {
      if (held !== undefined) {
        return state;
      }
      const bwrap = findBwrap();
      const now = bwrap === undefined ? missing : await tried(bwrap, { base, run }, signal);
      // A check that ran beside this one may have found the wall holding meanwhile.
      if (held === undefined) {
        held = now.kind === "held" ? bwrap : undefined;
        state = now;
      }
      return state;
    },
    wrap(launch: CommandLaunch): CommandLaunch {
      if (held === undefined) {
        throw new BinferenceError({
          code: "platform.no_wall",
          message: state.kind === "none" ? state.reason : "",
        });
      }
      return { file: held, args: [...base, launch.file, ...launch.args] };
    },
  };
}
