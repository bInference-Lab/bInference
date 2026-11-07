/** A command the shell host runs: the program and its arguments, launched without a shell. */
export interface CommandLaunch {
  readonly file: string;
  readonly args: readonly string[];
}
