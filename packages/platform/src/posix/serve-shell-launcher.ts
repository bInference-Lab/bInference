import { createServer, type Socket } from "node:net";
import type { ShellLauncher } from "../ports.js";
import type { RunningShell, ShellEnd } from "../shell-launch.js";
import {
  isStopLine,
  type LauncherLine,
  lineOf,
  maxLauncherLineBytes,
  parseLaunch,
} from "./shell-launcher-lines.schema.js";
import { readSocketLines } from "./socket-lines.js";

/** What the image's shell launcher runs with (decision 0412). */
export interface ShellLauncherService {
  /** The socket it listens on, in a folder only the engine's group may open. */
  readonly socket: string;
  /** What runs each command: bash behind the OS user the launcher runs as. */
  readonly launcher: ShellLauncher;
  /** The variables every command gets in place of the engine's: `HOME`, `USER` and `LOGNAME`. */
  readonly own: Readonly<Record<string, string>>;
}

/** The launcher as it serves: `closed` settles once the socket closed and every command ended. */
export interface ServedShellLauncher {
  readonly closed: Promise<void>;
}

function send(socket: Socket, line: LauncherLine): void {
  if (socket.writable) {
    socket.write(lineOf(line));
  }
}

// Starts the command a connection's first line names, or ends a connection that names none.
function startFor(
  text: string,
  socket: Socket,
  service: ShellLauncherService,
): RunningShell | undefined {
  const launch = parseLaunch(text);
  if (launch === undefined) {
    socket.destroy();
    return undefined;
  }
  const env = { ...launch.env, ...service.own };
  const running = service.launcher.start({ ...launch, env }, (output) => {
    send(socket, { output });
  });
  send(socket, { started: true });
  const told = (end: ShellEnd): void => {
    send(socket, { end });
    socket.end();
  };
  running.ended.then(told, () => socket.destroy());
  return running;
}

// Holds each command while it runs, so a stop of the launcher stops it.
function hold(running: Set<RunningShell>, command: RunningShell): void {
  running.add(command);
  const forget = (): void => {
    running.delete(command);
  };
  command.ended.then(forget, forget);
}

// One connection runs one command: its first line starts it, a stop line or the connection's
// close stops it, and any other line ends the connection, and so the command.
function serve(socket: Socket, service: ShellLauncherService, running: Set<RunningShell>): void {
  let command: RunningShell | undefined;
  socket.on("error", () => socket.destroy());
  readSocketLines(socket, maxLauncherLineBytes, (text) => {
    if (command === undefined) {
      command = startFor(text, socket, service);
      if (command !== undefined) {
        hold(running, command);
      }
    } else if (isStopLine(text)) {
      command.stop();
    } else {
      socket.destroy();
    }
  });
  socket.once("close", () => command?.stop());
}

/**
 * Serves the image's shell launcher (decision 0412) on `socket`: one command per connection, run
 * by `launcher` with the engine's environment and the launcher's own `HOME`, `USER` and
 * `LOGNAME`. It writes `started`, each piece of output and the end as JSON lines, then closes. A
 * first line that is no command, a line over 1 MiB, or any line but a stop after it ends the
 * connection; a stop line or the connection's close stops the command with everything it
 * started. The signal closes the socket and stops every command; `closed` settles once all ended.
 */
export async function serveShellLauncher(
  service: ShellLauncherService,
  signal: AbortSignal,
): Promise<ServedShellLauncher> {
  const running = new Set<RunningShell>();
  const server = createServer((socket) => serve(socket, service, running));
  const closed = new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        server.close();
        const ends = [...running].map(async (command) => {
          command.stop();
          return command.ended;
        });
        Promise.allSettled(ends).then(() => resolve(), resolve);
      },
      { once: true },
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ path: service.socket, readableAll: true, writableAll: true }, () =>
      resolve({ closed }),
    );
  });
}
