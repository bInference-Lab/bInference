import { once } from "node:events";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { IpcBindOptions, IpcBinding } from "./ipc-binding.js";

const maxConnections = 64;
const unreachableCodes: ReadonlySet<string> = new Set(["ENOENT", "ECONNREFUSED"]);

function codeOf(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function bindingOf(server: Server, sockets: Set<Socket>): IpcBinding {
  return {
    close: async () => {
      const closed = once(server, "close");
      server.close();
      sockets.forEach((socket) => socket.destroy());
      await closed;
    },
  };
}

/**
 * Listens on a socket path or pipe name. Returns `in_use` when another listener holds it. At most
 * 64 connections are open at once; Node closes any beyond that as it accepts them.
 */
export async function listenOn(
  address: string,
  options: IpcBindOptions,
): Promise<Result<IpcBinding, "in_use">> {
  options.signal.throwIfAborted();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    options.onSocket(socket);
  });
  server.maxConnections = maxConnections;
  try {
    server.listen(address);
    await once(server, "listening");
  } catch (error) {
    if (error instanceof Error && codeOf(error) === "EADDRINUSE") {
      return err("in_use");
    }
    throw new BinferenceError({
      code: "platform.ipc_listen_failed",
      message: `Could not listen on ${address}.`,
      cause: error,
      details: { address },
    });
  }
  return ok(bindingOf(server, sockets));
}

/** Connects to a socket path or pipe name. Returns `unreachable` when nobody listens there. */
export async function connectTo(
  address: string,
  signal: AbortSignal,
): Promise<Result<Socket, "unreachable">> {
  signal.throwIfAborted();
  const socket = createConnection({ path: address });
  try {
    await once(socket, "connect", { signal });
  } catch (error) {
    socket.destroy();
    if (error instanceof Error && unreachableCodes.has(codeOf(error) ?? "")) {
      return err("unreachable");
    }
    throw signal.aborted
      ? signal.reason
      : new BinferenceError({
          code: "platform.ipc_connect_failed",
          message: `Could not connect to ${address}.`,
          cause: error,
          details: { address },
        });
  }
  return ok(socket);
}
