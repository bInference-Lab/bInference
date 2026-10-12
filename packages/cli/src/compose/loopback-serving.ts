import { once } from "node:events";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import type { Clock } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { type ClientKind, operations } from "@binference/protocol";
import { WebSocket } from "ws";
import type { ComposedEngine } from "./compose-engine.js";

async function listenOnLoopback(server: NetServer): Promise<number> {
  server.listen({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const bound = server.address();
  return bound !== null && typeof bound === "object" ? bound.port : 0;
}

/** A composed engine's server behind an IPC stand-in, and the clients that signed in to it. */
export interface LoopbackServing {
  /** The owner's CLI, signed in with every scope. */
  readonly client: ProtocolClient;
  /** Opens another client over the IPC stand-in, signed in with a token's secret. */
  connect(secret: string, kind?: ClientKind): Promise<ProtocolClient>;
  /** Closes every client, the relays to Telegram and the browsers, the IPC stand-in and the server. */
  close(): Promise<void>;
}

/**
 * Serves a composed engine behind a loopback TCP stand-in for IPC, with a CLI client signed in
 * through the access store with the CLI token's secret.
 */
export async function serveOnLoopback(
  composed: ComposedEngine,
  options: { readonly clock: Clock; readonly cliSecret: string },
): Promise<LoopbackServing> {
  const { clock } = options;
  // The platform's IPC endpoint hands its sockets to the server the same way.
  const ipc = createNetServer((socket) => composed.server.acceptIpc(socket));
  const port = await listenOnLoopback(ipc);
  const clients: ProtocolClient[] = [];
  const connect = async (secret: string, kind: ClientKind = "cli"): Promise<ProtocolClient> => {
    const opened = createProtocolClient({
      operations,
      openSocket: () => new WebSocket(`ws://127.0.0.1:${String(port)}/ws`),
      client: { kind, version: "test" },
      credential: { token: secret },
      clock,
      random: createSeededRandom(11 + clients.length),
      logger: createMemoryLogger({ subsystem: "client" }),
    });
    clients.push(opened);
    await opened.connect(AbortSignal.timeout(10_000));
    return opened;
  };
  const client = await connect(options.cliSecret);
  return {
    client,
    connect,
    async close() {
      clients.forEach((opened) => opened.close());
      await composed.telegram?.close();
      await composed.webPush?.close();
      ipc.close();
      await composed.server.close();
    },
  };
}
