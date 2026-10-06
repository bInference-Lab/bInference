import { isAbsolute } from "node:path";
import { BinferenceError } from "@binference/core";

/** A program that the OS starts at the owner's login, in their session, and restarts after a crash. */
export interface ServiceDefinition {
  /** 1 to 40 lowercase letters, digits and dashes, starting with a letter, such as `engine`. */
  readonly name: string;
  /** One line that the OS's list of services shows. */
  readonly description: string;
  /** The program's absolute path, such as `process.execPath`. */
  readonly program: string;
  readonly args: readonly string[];
  /** The absolute folder the program starts in. */
  readonly workingFolder: string;
  /**
   * The absolute file that macOS and Linux append the program's output and errors to, in a folder
   * that exists. Windows keeps no output of a scheduled task, so there the program writes its own
   * log.
   */
  readonly logFile: string;
  /** How long a stop waits for the program to exit before the OS kills it: 1 s to 120 s. */
  readonly stopTimeoutMs: number;
}

/** What the OS reports about a service. */
export type ServiceStatus =
  | { readonly state: "not_installed" }
  | {
      readonly state: "running" | "stopped";
      /** Whether the OS starts it at the owner's next login. */
      readonly startsAtLogin: boolean;
    };

const namePattern = /^[a-z][a-z0-9-]{0,39}$/;
// A line break or a NUL would end a line of a unit file or a field of a definition early.
const breakingCharacter = /[\r\n\0]/;

/**
 * The fault for a definition the OS cannot take, `platform.service_definition_invalid`; `problem`
 * completes the sentence "The service <name> ...".
 */
export function invalidServiceDefinition(name: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "platform.service_definition_invalid",
    message: `The service ${JSON.stringify(name)} ${problem}.`,
    details: { name },
  });
}

/**
 * Checks a service name: 1 to 40 lowercase letters, digits and dashes, starting with a letter.
 * Throws `platform.service_definition_invalid` otherwise, before anything touches the OS.
 */
export function checkServiceName(name: string): void {
  if (!namePattern.test(name)) {
    throw invalidServiceDefinition(
      name,
      "needs a name of lowercase letters, digits and dashes, such as engine",
    );
  }
}

/**
 * Checks a whole definition: its name, absolute paths, a stop timeout from 1 s to 120 s, and no
 * line break in any text. Throws `platform.service_definition_invalid` otherwise. An adapter passes
 * its OS's `isAbsolute`, such as `win32.isAbsolute`; this OS's is the default.
 */
export function checkServiceDefinition(
  definition: ServiceDefinition,
  isAbsolutePath: (path: string) => boolean = isAbsolute,
): void {
  checkServiceName(definition.name);
  const paths = [definition.program, definition.workingFolder, definition.logFile];
  if (!paths.every((path) => isAbsolutePath(path))) {
    throw invalidServiceDefinition(
      definition.name,
      "needs absolute paths for its program, folder and log",
    );
  }
  const texts = [definition.description, ...paths, ...definition.args];
  if (texts.some((text) => breakingCharacter.test(text))) {
    throw invalidServiceDefinition(definition.name, "has a line break or a NUL in its text");
  }
  const { stopTimeoutMs } = definition;
  if (!Number.isInteger(stopTimeoutMs) || stopTimeoutMs < 1000 || stopTimeoutMs > 120_000) {
    throw invalidServiceDefinition(definition.name, "needs a stop timeout from 1000 to 120000 ms");
  }
}
