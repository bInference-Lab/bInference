import type { ReadyFrame } from "@binference/protocol";
import type { Connection } from "./open-connection.js";

/** Where a client stands. */
export type ClientStatus =
  | { readonly state: "idle" | "connecting" }
  | { readonly state: "ready"; readonly ready: ReadyFrame }
  | { readonly state: "closed"; readonly error: Error };

/** The client's one connection and where the client stands; the client's own loop moves it. */
export interface ConnectionStatus {
  current(): ClientStatus;
  /** The ready connection; none while connecting or closed. */
  connection(): Connection | undefined;
  set(status: ClientStatus, connection?: Connection): void;
}

/** Creates a {@link ConnectionStatus} that starts idle. */
export function createConnectionStatus(): ConnectionStatus {
  let current: ClientStatus = { state: "idle" };
  let ready: Connection | undefined;
  return {
    current: () => current,
    connection: () => ready,
    set(status, connection) {
      current = status;
      ready = connection;
    },
  };
}
