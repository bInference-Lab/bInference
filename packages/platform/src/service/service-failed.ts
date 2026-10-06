import { BinferenceError } from "@binference/core";
import type { ProgramExit } from "../run-command.js";

// Enough of a service manager's answer to find the fault, never a whole log.
const maxOutputChars = 500;

/**
 * The fault a service adapter throws when the OS's service manager refuses or gives no answer:
 * `platform.service_failed`, with the program's exit code and the start of its answer.
 */
export function serviceFailed(message: string, exit?: ProgramExit): BinferenceError {
  const output = exit === undefined ? "" : (exit.stderr || exit.stdout).trim();
  return new BinferenceError({
    code: "platform.service_failed",
    message,
    details:
      exit === undefined
        ? {}
        : { exitCode: exit.exitCode, output: output.slice(0, maxOutputChars) },
  });
}
