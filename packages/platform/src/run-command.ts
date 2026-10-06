import { BinferenceError } from "@binference/core";
import { execa } from "execa";

/** Runs a program with an argument array and returns its standard output. */
export type RunProgram = (
  file: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;

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
