import type { ProtocolServer } from "@binference/server";

/** The console's origin once the HTTP listener bound, which the pairing links name. */
export interface ConsoleOrigin {
  readonly get: () => string | undefined;
  /** The server, whose `start` records the origin of the port it bound. */
  readonly watch: (server: ProtocolServer) => ProtocolServer;
}

/**
 * A cell for the console's origin: empty until the server's `start` binds the HTTP listener, then
 * `http://127.0.0.1:<port>` of the port it bound.
 */
export function consoleOriginCell(): ConsoleOrigin {
  let origin: string | undefined;
  return {
    get: () => origin,
    watch: (server) => ({
      ...server,
      async start(signal) {
        const address = await server.start(signal);
        origin = address === undefined ? undefined : `http://127.0.0.1:${String(address.port)}`;
        return address;
      },
    }),
  };
}
