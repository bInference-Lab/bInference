import type { Server } from "node:http";
import { BinferenceError } from "@binference/core";

/** The address a listener bound. */
export interface ServerAddress {
  readonly host: string;
  readonly port: number;
}

function listenFailed(at: ServerAddress, cause: Error): BinferenceError {
  return new BinferenceError({
    code: "server.listen_failed",
    message: `The server could not listen on ${at.host}:${String(at.port)}.`,
    details: { host: at.host, port: at.port },
    cause,
  });
}

/**
 * Binds an HTTP server at the host and port and resolves with the address it bound. Throws
 * `server.listen_failed` when the address is taken or the signal aborts first.
 */
export async function bindListener(
  server: Server,
  at: ServerAddress,
  signal: AbortSignal,
): Promise<ServerAddress> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => reject(listenFailed(at, error));
    const onAbort = (): void => {
      server.close();
      fail(new Error("The start was aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    server.once("error", fail);
    server.listen({ host: at.host, port: at.port }, () => {
      server.off("error", fail);
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw listenFailed(at, new Error("The listener reports no TCP address."));
  }
  return { host: address.address, port: address.port };
}
