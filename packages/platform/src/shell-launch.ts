/** One command for the agent's shell: its text, the folder it runs in and how long it may run. */
export interface ShellLaunch {
  /** The command line, run by the machine's shell as the owner would type it. */
  readonly command: string;
  /** The folder it starts in, which exists. */
  readonly folder: string;
  /** The most it may run, in milliseconds; 0 for no limit. */
  readonly timeoutMs: number;
  /**
   * The whole environment it gets. The caller leaves out every variable that holds a binference
   * secret, so a command cannot read one there.
   */
  readonly env: Readonly<Record<string, string>>;
}

/** How a command ended. */
export interface ShellEnd {
  /** Its exit code, when it exited rather than being killed. */
  readonly exitCode?: number;
  /** The signal that ended it, when one did. */
  readonly signal?: string;
  /** Its time limit ended it. */
  readonly timedOut: boolean;
  /** A stop ended it. */
  readonly stopped: boolean;
  /** It never started: the shell program could not be run. */
  readonly failedToStart?: string;
}

/** A command that runs: its end, and a way to stop it with everything it started. */
export interface RunningShell {
  readonly ended: Promise<ShellEnd>;
  /** Ends the command and every process it started. Safe to call more than once. */
  stop(): void;
}

/** The shell a command runs in: the program and the arguments before the command line. */
export interface ShellProgram {
  readonly file: string;
  readonly args: readonly string[];
}
