import type { Result } from "@binference/core";
import type { CommandRequest, LocatedPrograms, RunningCommand } from "./command-request.js";
import type { AllowedCommandRecord, ShellWatchRecord } from "./shell-records.js";

/**
 * The shell's rows the engine keeps (decision 0409): the commands the owner allowed always, and
 * the commands the agent left running whose end it has still to hear. Its SQLite adapter is in
 * `@binference/store`.
 */
export interface ShellStore {
  /** Every allowed command, oldest first. */
  allowed(options: { readonly signal: AbortSignal }): Promise<readonly AllowedCommandRecord[]>;
  /**
   * Keeps each command no allowed command holds yet with the same program, arguments and folder,
   * and answers the ones it kept, in order.
   */
  allow(
    commands: readonly AllowedCommandRecord[],
    options: { readonly signal: AbortSignal },
  ): Promise<readonly AllowedCommandRecord[]>;
  /** Removes an allowed command and answers it; `undefined` when none has the id. */
  disallow(
    id: string,
    options: { readonly signal: AbortSignal },
  ): Promise<AllowedCommandRecord | undefined>;
  /** Keeps a command whose end the agent is to hear, once. */
  watch(watch: ShellWatchRecord, options: { readonly signal: AbortSignal }): Promise<void>;
  /** Drops a job's row; `true` only for the call that dropped it, which tells its end. */
  unwatch(job: string, options: { readonly signal: AbortSignal }): Promise<boolean>;
  /** Every job whose end is still to be told, oldest first. */
  watched(options: { readonly signal: AbortSignal }): Promise<readonly ShellWatchRecord[]>;
}

/**
 * Runs the agent's commands in the owner's shell behind the command wall (decision 0378). The
 * composition root builds it from the platform's shell launcher, with the environment cleared of
 * binference's secrets and the owner's home folder as the default folder.
 */
export interface CommandRunner {
  /**
   * Starts a command and hands its output to `onOutput` as it comes. Answers `no_wall` when this
   * machine cannot keep it from binference's own folder, and `folder_missing` when its folder
   * does not exist; a command then never starts.
   */
  start(
    request: CommandRequest,
    onOutput: (text: string) => void,
  ): Result<RunningCommand, "no_wall" | "folder_missing">;
  /** The text with seed phrases and private key blocks masked, before the model reads it. */
  mask(text: string): string;
  /**
   * The shell commands start in: a POSIX shell, or PowerShell, whose lines no allowed command
   * covers (decision 0409).
   */
  readonly dialect: "posix" | "powershell";
  /**
   * Where a command line would run, as the allowed commands judge it: the real path of its folder,
   * `folder_missing` when it does not exist, and the real path of each program, a word with a `/`
   * from that folder and any other on the command's `PATH`, `undefined` for one it cannot find.
   */
  locate(
    where: { readonly folder?: string; readonly programs: readonly string[] },
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LocatedPrograms, "folder_missing">>;
}
