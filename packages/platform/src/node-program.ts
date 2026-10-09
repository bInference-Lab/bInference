import { BinferenceError } from "@binference/core";
import { execa } from "execa";

/** A Node program this process started, held through its standard input and output. */
export interface NodeProgram {
  /** Writes text to the program's standard input; rejects once the input is closed. */
  write(text: string): Promise<void>;
  /** Closes the program's standard input, and resolves once every write before it is flushed. */
  end(): Promise<void>;
  /** What the program writes to its standard output. Its standard error is dropped. */
  readonly output: AsyncIterable<Uint8Array>;
  /** Settles once the program has ended: its exit code, or `undefined` when a kill ended it. */
  readonly exited: Promise<number | undefined>;
  /** Ends the program at once: `SIGKILL` on macOS and Linux, `TerminateProcess` on Windows. */
  kill(): void;
}

/** What one Node program starts with. */
export interface NodeProgramOptions {
  /** Node's own options, then the program's path and the program's arguments. */
  readonly args: readonly string[];
  /**
   * The environment of the process that starts it. The program gets from it only what this OS
   * needs to run Node at all: `SystemRoot` on Windows, nothing on macOS and Linux.
   */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  /** Variables the program gets besides those. */
  readonly env?: Readonly<Record<string, string>>;
  /** Ends the program at once when it aborts. */
  readonly signal: AbortSignal;
}

// Windows loads its system libraries from SystemRoot; without it Node's crypto and sockets fail.
const windowsNeeds = ["SystemRoot"];

function needed(parentEnv: NodeProgramOptions["parentEnv"]): Readonly<Record<string, string>> {
  if (process.platform !== "win32") {
    return {};
  }
  // Windows names ignore case, and a copied environment may spell them either way.
  const entries = Object.entries(parentEnv).flatMap(([name, value]) =>
    value !== undefined && windowsNeeds.some((need) => need.toLowerCase() === name.toLowerCase())
      ? [[name, value] as const]
      : [],
  );
  return Object.fromEntries(entries);
}

function closedInput(cause: Error): BinferenceError {
  return new BinferenceError({
    code: "platform.program_input_closed",
    message: "The program's standard input is closed; the program has likely ended.",
    cause,
  });
}

/**
 * Starts `process.execPath` with the arguments, with pipes to its standard input and output, no
 * shell and no window, and an environment of only what the options name. It runs until it ends,
 * the signal aborts or `kill` is called, and it ends with this process.
 */
export function startNodeProgram(options: NodeProgramOptions): NodeProgram {
  const child = execa(process.execPath, options.args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...needed(options.parentEnv), ...options.env },
    extendEnv: false,
    buffer: false,
    reject: false,
    windowsHide: true,
    cancelSignal: options.signal,
    killSignal: "SIGKILL",
  });
  // A write to a program that ended fails through the write's callback, never as a stray error.
  child.stdin.on("error", () => undefined);
  return {
    write: async (text) =>
      new Promise((resolve, reject) => {
        child.stdin.write(text, (error) => {
          if (error === null || error === undefined) {
            resolve();
          } else {
            reject(closedInput(error));
          }
        });
      }),
    end: async () =>
      new Promise((resolve) => {
        child.stdin.end(() => resolve());
      }),
    output: child.stdout,
    exited: child.then((result) => result.exitCode),
    kill: () => {
      child.kill("SIGKILL");
    },
  };
}
