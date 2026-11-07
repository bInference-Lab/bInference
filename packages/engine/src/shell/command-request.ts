/** One command for the owner's shell. */
export interface CommandRequest {
  readonly command: string;
  /** The folder it starts in: absolute, or under the owner's home folder; that folder when absent. */
  readonly folder?: string;
  /** The most it may run, in milliseconds; 0 for no limit. */
  readonly timeoutMs: number;
}

/** How a command ended. */
export interface CommandEnd {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly timedOut: boolean;
  readonly stopped: boolean;
}

/** A command that runs: the folder it runs in, its end, and a way to stop it. */
export interface RunningCommand {
  readonly folder: string;
  readonly ended: Promise<CommandEnd>;
  /** Ends it with every process it started. Safe to call more than once. */
  stop(): void;
}
