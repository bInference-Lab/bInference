import { BinferenceError } from "@binference/core";
import { execa } from "execa";

/** Runs a program with an argument array and returns its standard output. */
export type RunProgram = (
  file: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;

/** How a program ended: its exit code and what it wrote. */
export interface ProgramExit {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a program with an argument array and returns how it ended, whatever its exit code. */
export type RunToExit = (
  file: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<ProgramExit>;

const commandTimeoutMs = 15_000;

// Windows PowerShell started through another process, such as this one under a PowerShell 7
// terminal, inherits PowerShell 7's module paths and cannot load its own modules. Microsoft's
// fix is to start it without PSModulePath, so it builds its default value (about_PSModulePath).
// Windows names ignore case and Node passes only the first spelling in sorted order, before it
// drops `undefined` values; the all-capitals name sorts first, so it removes every spelling.
const windowsPowerShell = /(?:^|[\\/])powershell(?:\.exe)?$/i;

function environmentFor(file: string): Readonly<Record<string, string | undefined>> {
  return windowsPowerShell.test(file) ? { PSMODULEPATH: undefined } : {};
}

/**
 * Runs an OS program through execa, with no shell, no input and a 15 second limit, and returns its
 * standard output. Throws `platform.command_failed` when the program fails, times out or the
 * signal aborts.
 */
export async function runCommand(
  file: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  try {
    const result = await execa(file, args, {
      cancelSignal: signal,
      timeout: commandTimeoutMs,
      stdin: "ignore",
      windowsHide: true,
      env: environmentFor(file),
    });
    return result.stdout;
  } catch (error) {
    throw new BinferenceError({
      code: "platform.command_failed",
      message: `${file} failed.`,
      cause: error,
      details: { file },
    });
  }
}

/**
 * Runs an OS program as {@link runCommand} does, but returns its exit code with its output, so a
 * caller reads an answer such as "not found" from the code. Throws `platform.command_failed` only
 * when the program cannot start, times out or the signal aborts.
 */
export async function runCommandToExit(
  file: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ProgramExit> {
  const result = await execa(file, args, {
    cancelSignal: signal,
    timeout: commandTimeoutMs,
    stdin: "ignore",
    windowsHide: true,
    env: environmentFor(file),
    reject: false,
  });
  // The program never ran to its end: it did not start, timed out or was stopped by the signal.
  if (
    result.exitCode === undefined ||
    result.code !== undefined ||
    result.timedOut ||
    result.isCanceled
  ) {
    throw new BinferenceError({
      code: "platform.command_failed",
      message: `${file} did not run to its end.`,
      cause: result,
      details: { file },
    });
  }
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
