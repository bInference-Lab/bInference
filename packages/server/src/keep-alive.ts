import type { Clock } from "@binference/core";
import type { WebSocket } from "ws";

/** How a connection is kept alive. */
export interface KeepAliveOptions {
  readonly socket: WebSocket;
  readonly clock: Clock;
  readonly pingIntervalMs: number;
  readonly pongTimeoutMs: number;
  /** Stops the pings; abort it when the connection closes. */
  readonly signal: AbortSignal;
}

/**
 * Pings the socket every `pingIntervalMs` on the clock, and cuts it when no pong arrived for
 * `pongTimeoutMs`. Each ping waits on its own sleep, so a long connection holds one timer.
 */
export function keepAlive(options: KeepAliveOptions): void {
  const { socket, clock, signal } = options;
  let pongAt = clock.now();
  socket.on("pong", () => {
    pongAt = clock.now();
  });
  const beat = (): void => {
    if (clock.now() - pongAt > options.pongTimeoutMs) {
      socket.terminate();
      return;
    }
    socket.ping();
    wait();
  };
  // A sleep rejects only when the connection closed; nothing is left to do then.
  const wait = (): void => {
    void clock.sleep(options.pingIntervalMs, signal).then(beat, () => undefined);
  };
  wait();
}
