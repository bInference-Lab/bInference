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
    reject: false,
  });
  // No exit code means the program never ran to its end: it did not start, timed out or was
  // stopped by the signal.
  if (result.exitCode === undefined) {
    throw new BinferenceError({
      code: "platform.command_failed",
      message: `${file} did not run to its end.`,
      cause: result,
      details: { file },
    });
  }
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
