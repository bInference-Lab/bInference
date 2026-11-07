/** What every file call carries: its stop, and whether it must stay inside the workspace. */
export interface FileCall {
  readonly signal: AbortSignal;
  readonly workspaceOnly: boolean;
}

/** A file as read: its absolute path and its bytes. */
export interface ReadFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The owner's file settings, read at each call. */
export interface FileSettings {
  /** Keeps file reads, writes and edits inside the agent's workspace. */
  readonly workspaceOnly: boolean;
  /** Keeps patches inside the agent's workspace. */
  readonly patchWorkspaceOnly: boolean;
}
