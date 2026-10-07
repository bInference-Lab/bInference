import type { Clock, Random } from "@binference/core";
import type { SignalEvents } from "@binference/platform";

/**
 * What the `binference` command takes from its process. The entry file fills it from `process`;
 * tests fill it with a temporary state folder, a manual clock and an emitter for stop signals.
 */
export interface CliHost {
  /** The arguments after the program's name, such as `["status", "--json"]`. */
  readonly argv: readonly string[];
  /** The process's environment: `BINFERENCE_HOME` and every `BINFERENCE_*` config variable. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Writes to standard output. */
  readonly out: (text: string) => void;
  /** Writes to standard error. */
  readonly err: (text: string) => void;
  readonly clock: Clock;
  readonly random: Random;
  /** Where stop signals arrive: `process` in the entry file. */
  readonly signals: SignalEvents;
  /** The binference release, such as `2026.10.0`. */
  readonly version: string;
  /** The account's home folder; the OS's own answer when left out. */
  readonly homeDir?: string;
  /** Node options for the store's worker threads, such as a TypeScript loader in tests. */
  readonly workerExecArgv?: readonly string[];
}
