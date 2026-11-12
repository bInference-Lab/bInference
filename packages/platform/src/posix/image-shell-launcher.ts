import { connect, type Socket } from "node:net";
import type { Clock } from "@binference/core";
import type { ShellLauncher } from "../ports.js";
import type { RunningShell, ShellEnd, ShellLaunch } from "../shell-launch.js";
import { osUserWall } from "./os-user-wall.js";
import { lineOf, maxLauncherLineBytes, parseLauncherLine } from "./shell-launcher-lines.schema.js";
import { readSocketLines } from "./socket-lines.js";

/** Where the engine finds the image's shell launcher, and the clock its own limits run on. */
export interface ImageShellOptions {
  /** The launcher's socket, as `BINFERENCE_SHELL_LAUNCHER` names it. */
  readonly socket: string;
  /** The home of the user the launcher runs commands as. */
  readonly home: string;
  readonly clock: Clock;
}

// The launcher ends a command within 5 seconds of its stop or its limit; past this the engine ends
// the connection itself, and with it the command.
const graceMs = 10_000;

type EndCause = "timeout" | "stop";

/** What one command's connection knows: whether the launcher said it started, and why it ends. */
interface Heard {
  started: boolean;
  fault?: string | undefined;
  cause?: EndCause;
}

// What the engine knows of a command whose connection closed before its end: a launcher that never
// said it started gives the reason it could not be reached.
function lostEnd(heard: Heard): ShellEnd {
  const ended = { timedOut: heard.cause === "timeout", stopped: heard.cause === "stop" };
  return heard.started ? ended : { ...ended, failedToStart: heard.fault ?? "launcher_closed" };
}

// Nothing the launcher sends is trusted: a command can replace it, so a line out of shape ends the
// connection.
function readLines(
  socket: Socket,
  on: {
    readonly started: () => void;
    readonly output: (text: string) => void;
    readonly end: (end: ShellEnd) => void;
  },
): void {
  readSocketLines(socket, maxLauncherLineBytes, (text) => {
    const line = parseLauncherLine(text);
    if (line === undefined) {
      socket.destroy();
    } else if ("end" in line) {
      on.end(line.end);
    } else if ("output" in line) {
      on.output(line.output);
    } else {
      on.started();
    }
  });
}

function startThrough(
  options: ImageShellOptions,
  launch: ShellLaunch,
  onOutput: (text: string) => void,
): RunningShell {
  const done = new AbortController();
  const heard: Heard = { started: false };
  const started = (): void => {
    heard.started = true;
  };
  const socket = connect(options.socket);
  const ended = new Promise<ShellEnd>((resolve) => {
    const finish = (end: ShellEnd): void => {
      if (!done.signal.aborted) {
        done.abort();
        resolve(end);
        socket.destroy();
      }
    };
    readLines(socket, { started, output: onOutput, end: finish });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      heard.fault ??= error.code;
    });
    socket.once("close", () => finish(lostEnd(heard)));
  });
  socket.write(lineOf(launch));
  const endAfter = (why: EndCause, delayMs: number): void => {
    const cut = (): void => {
      heard.cause ??= why;
      socket.destroy();
    };
    options.clock.sleep(delayMs, done.signal).then(cut, () => undefined);
  };
  if (launch.timeoutMs > 0) {
    endAfter("timeout", launch.timeoutMs + graceMs);
  }
  const stop = (): void => {
    if (heard.cause === undefined && !done.signal.aborted) {
      heard.cause = "stop";
      socket.write(lineOf({ stop: true }));
      endAfter("stop", graceMs);
    }
  };
  return { ended, stop };
}

/**
 * The agent's shell in the Docker image (decision 0412): each command goes over a connection of
 * its own to the image's shell launcher, which runs it in bash as `binference-shell`, a user that
 * cannot cross the state folder. The wall is that user, so it always holds; commands start in
 * that user's `home`. The launcher's lines are checked, never trusted: one out of shape or over
 * 1 MiB ends the connection, and a command that outlives its stop or its time limit by 10
 * seconds is ended with it. A launcher that cannot be reached ends a command with
 * `failedToStart` set to the socket's error code.
 */
export function createImageShellLauncher(options: ImageShellOptions): ShellLauncher {
  return {
    wall: osUserWall,
    home: options.home,
    start: (launch, onOutput) => startThrough(options, launch, onOutput),
  };
}
