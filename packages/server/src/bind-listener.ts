import type { Server } from "node:http";
import { BinferenceError } from "@binference/core";

/** The address a listener bound. */
export interface ServerAddress {
  readonly host: string;
  readonly port: number;
}

// The system's code for why the bind failed, such as `EADDRINUSE`, or `none` for an abort.
function systemCodeOf(cause: Error): string {
  return "code" in cause && typeof cause.code === "string" ? cause.code : "none";
}

function listenFailed(at: ServerAddress, cause: Error): BinferenceError {
  return new BinferenceError({
    code: "server.listen_failed",
    message: `The server could not listen on ${at.host}:${String(at.port)}.`,
    details: { host: at.host, port: at.port, systemCode: systemCodeOf(cause) },
    cause,
  });
}

/**
 * Whether a failed `bindListener` found its port held by another listener (`EADDRINUSE`), as
 * opposed to a refused address, a port it may not take, or a start that was stopped.
 */
export function isPortTaken(error: BinferenceError): boolean {
  return error.code === "server.listen_failed" && error.details["systemCode"] === "EADDRINUSE";
}

/**
 * Binds an HTTP server at the host and port and resolves with the address it bound. Throws
 * `server.listen_failed` when the address is taken or the signal aborts first, with the system's
 * code in `details.systemCode` (`none` for an abort); `isPortTaken` reads it.
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
