import { BinferenceError } from "@binference/core";
import { execa } from "execa";
import { whichCommand } from "which-command";

/** How a program in the terminal ended: its exit code, or the signal that ended it. */
export interface TerminalExit {
  readonly exitCode?: number;
  readonly signal?: string;
}

/** A program that shares this process's terminal. */
export interface TerminalProgram {
  /** Settles once the program has ended. */
  readonly exited: Promise<TerminalExit>;
}

/** What one program in the terminal starts with. */
export interface TerminalProgramOptions {
  /** The program's name, found on the `PATH` of `env`, or its absolute path. */
  readonly file: string;
  readonly args: readonly string[];
  /** The program's whole environment: it gets nothing else. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Asks the program to end when it aborts: `SIGTERM` on macOS and Linux, `TerminateProcess` on
   * Windows.
   */
  readonly signal: AbortSignal;
}

// Windows names ignore case, so its PATH may be spelled `Path`.
function pathOf(env: TerminalProgramOptions["env"]): string | undefined {
  return Object.entries(env).find(([name]) => name.toUpperCase() === "PATH")?.[1];
}

/**
 * Starts a program on this process's standard input, output and error, with no shell, an
 * argument array and only the environment given, for a person to use until it ends. Throws
 * `platform.command_failed` when the program is not on that `PATH`.
 */
export async function startTerminalProgram(
  options: TerminalProgramOptions,
): Promise<TerminalProgram> {
  const path = pathOf(options.env);
  const found = await whichCommand(options.file, path === undefined ? {} : { path });
  if (found === undefined) {
    throw new BinferenceError({
      code: "platform.command_failed",
      message: `${options.file} was not found; check that it is installed and on PATH.`,
      details: { file: options.file },
    });
  }
  const child = execa(found, options.args, {
    stdio: "inherit",
    env: options.env,
    extendEnv: false,
    reject: false,
    cancelSignal: options.signal,
    killSignal: "SIGTERM",
  });
  return {
    exited: child.then(({ exitCode, signal }) => ({
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(signal === undefined ? {} : { signal }),
    })),
  };
}
