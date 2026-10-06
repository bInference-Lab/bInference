import type { Socket } from "node:net";

/** What an IPC listener needs: a deadline for binding, and what to do with each connection. */
export interface IpcBindOptions {
  readonly signal: AbortSignal;
  /** Receives each accepted connection; it owns the socket from then on. */
  readonly onSocket: (socket: Socket) => void;
}

/** An address this process listens on. */
export interface IpcBinding {
  /**
   * Stops accepting, ends every open connection and frees the address. Call it once, during
   * shutdown.
   */
  close(): Promise<void>;
}
