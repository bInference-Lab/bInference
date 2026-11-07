import type { Readable } from "node:stream";
import type { Clock } from "@binference/core";
import { execa } from "execa";
import type { CommandWall } from "./ports.js";
import type { RunningShell, ShellEnd, ShellLaunch, ShellProgram } from "./shell-launch.js";

/** How hard a process tree is asked to end. */
export type EndForce = "gentle" | "force";

/** What one OS adds to a command's start: its shell, how its process tree ends, and the wall. */
export interface ShellStartParts {
  readonly program: ShellProgram;
  readonly wall: CommandWall;
  /** Starts the command in a process group of its own, so the group can be ended whole. */
  readonly ownGroup: boolean;
  /** Times the command's limit and the wait before a forced end. */
  readonly clock: Clock;
  /** Ends the command's process and everything it started. */
  endTree(pid: number, force: EndForce): void;
}

// A command asked to end gently gets this long before it is ended by force.
const forceAfterMs = 5_000;

type EndCause = "timeout" | "stop";

interface ChildResult {
  readonly exitCode?: number | undefined;
  readonly signal?: string | undefined;
  readonly code?: string | undefined;
}

// The started command as this module reads it: its process number, its merged output, its end.
interface ShellChild extends PromiseLike<ChildResult> {
  readonly pid?: number | undefined;
  readonly all?: Readable | undefined;
}

function endOf(result: ChildResult, cause: EndCause | undefined): ShellEnd {
  const ended: ShellEnd = {
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    timedOut: cause === "timeout",
    stopped: cause === "stop",
  };
  // A program that never started has no exit code, no signal and a system error code.
  const neverRan = result.exitCode === undefined && result.signal === undefined;
  return neverRan && result.code !== undefined ? { ...ended, failedToStart: result.code } : ended;
}

// The shell runs the command line behind the wall, with standard output and error as one stream.
function spawn(launch: ShellLaunch, parts: ShellStartParts, signal: AbortSignal): ShellChild {
  const wrapped = parts.wall.wrap({
    file: parts.program.file,
    args: [...parts.program.args, launch.command],
  });
  return execa(wrapped.file, wrapped.args, {
    cwd: launch.folder,
    env: launch.env,
    extendEnv: false,
    stdin: "ignore",
    all: true,
    buffer: false,
    reject: false,
    windowsHide: true,
    detached: parts.ownGroup,
    cancelSignal: signal,
  });
}

// Hands each piece of output on as text; the returned function hands on what a split character
// left behind once the stream ends.
function pipeOutput(child: ShellChild, onOutput: (text: string) => void): () => void {
  const decoder = new TextDecoder("utf-8");
  const hand = (text: string): void => {
    if (text !== "") {
      onOutput(text);
    }
  };
  child.all?.on("data", (chunk: Uint8Array) => {
    hand(decoder.decode(chunk, { stream: true }));
  });
  return () => {
    hand(decoder.decode());
  };
}

/**
 * Starts one command in the OS's shell, behind the command wall, and hands each piece of its
 * output, standard output and error together, to `onOutput` as text. The command reads nothing
 * from standard input. Its time limit and a stop end it with every process it started: gently
 * first, then by force after 5 seconds. Throws `platform.no_wall` when the wall cannot hold.
 */
export function startWalledShell(
  launch: ShellLaunch,
  parts: ShellStartParts,
  onOutput: (text: string) => void,
): RunningShell {
  const forced = new AbortController();
  const done = new AbortController();
  const child = spawn(launch, parts, forced.signal);
  const flush = pipeOutput(child, onOutput);
  let cause: EndCause | undefined;
  // A wait the command's end cuts short is no fault.
  const after = (delayMs: number, then: () => void): void => {
    parts.clock.sleep(delayMs, done.signal).then(then, () => undefined);
  };
  const end = (why: EndCause): void => {
    const { pid } = child;
    if (done.signal.aborted || cause !== undefined || pid === undefined) {
      return;
    }
    cause = why;
    parts.endTree(pid, "gentle");
    after(forceAfterMs, () => {
      parts.endTree(pid, "force");
      forced.abort();
    });
  };
  if (launch.timeoutMs > 0) {
    after(launch.timeoutMs, () => end("timeout"));
  }
  const ended = (async () => {
    const result = await child;
    done.abort();
    flush();
    return endOf(result, cause);
  })();
  return { ended, stop: () => end("stop") };
}
