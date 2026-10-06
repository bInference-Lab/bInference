import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  type Logger,
  type Random,
} from "@binference/core";
import type { IdempotencyStore } from "@binference/engine";
import type { PushFrame } from "@binference/protocol";
import { WebSocketServer } from "ws";
import { createCallDispatch } from "./call-dispatch.js";
import { checkBind } from "./check-bind.js";
import type { ConnectionContext } from "./connection-link.js";
import type { EngineFacts } from "./engine-facts.js";
import { answerRequest, pathOf, refuseUpgrade } from "./http-routes.js";
import { createIdempotentWrites } from "./idempotent-writes.js";
import type { OperationHandlers, Transport } from "./operation-handlers.js";
import { createOriginCheck } from "./origin-check.js";
import { createPushHub, type PushEvent } from "./push-hub.js";
import { type Connection, serveConnection } from "./serve-connection.js";
import { defaultServerLimits, type ServerLimits } from "./server-limits.js";
import { describeOnce } from "./server-operations.js";
import { createSignIn, type ServerAuth } from "./sign-in.js";

/** Where the HTTP listener binds: the console, the Mini App and their WebSocket at `/ws`. */
export interface HttpListenOptions {
  /** `127.0.0.1` unless the owner set otherwise; a host beyond loopback needs `auth`. */
  readonly host: string;
  /** The port; 0 picks a free one, as tests do. */
  readonly port: number;
  /** Browser origins allowed besides the two loopback ones (config `engine.extraOrigins`). */
  readonly extraOrigins?: readonly string[];
}

/** What a protocol server is built from. */
export interface ProtocolServerOptions {
  /** The HTTP listener; without it the server serves IPC only. */
  readonly http?: HttpListenOptions;
  /** What sign-ins are checked against; without it every sign-in fails with `auth.required`. */
  readonly auth?: ServerAuth;
  /** Where each write's result is kept under its idempotency key. */
  readonly idempotency: IdempotencyStore;
  readonly handlers: OperationHandlers;
  readonly engine: EngineFacts;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
  readonly limits?: Partial<ServerLimits>;
}

/** The address the HTTP listener bound. */
export interface ServerAddress {
  readonly host: string;
  readonly port: number;
}

/** The engine's protocol server: one WebSocket per client over HTTP or local IPC. */
export interface ProtocolServer {
  /**
   * Binds the HTTP listener and resolves with its address, or with `undefined` when the server has
   * none. Throws `server.unsafe_bind` for a host beyond loopback without `auth`, before binding,
   * and `server.listen_failed` when the address is taken or the signal aborts first.
   */
  start(signal: AbortSignal): Promise<ServerAddress | undefined>;
  /**
   * Serves one connection the platform's IPC endpoint accepted. Over IPC, client tokens sign in
   * and local operations run; no origin is checked.
   */
  acceptIpc(socket: Socket): void;
  /** Pushes an event to every connection subscribed to its topic; see `PushHub.publish`. */
  publish(event: PushEvent): PushFrame;
  /**
   * Says `bye` with `engine.stopping` to every connection, waits `closeGraceMs` for them to close,
   * cuts the rest, aborts every running call and closes the listener. A second call waits for the
   * first.
   */
  close(): Promise<void>;
}

interface Listeners {
  readonly http: Server;
  readonly ipc: Server;
}

function listenFailed(http: HttpListenOptions, cause: Error): BinferenceError {
  return new BinferenceError({
    code: "server.listen_failed",
    message: `The server could not listen on ${http.host}:${String(http.port)}.`,
    details: { host: http.host, port: http.port },
    cause,
  });
}

async function listen(
  server: Server,
  http: HttpListenOptions,
  signal: AbortSignal,
): Promise<ServerAddress> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => reject(listenFailed(http, error));
    const onAbort = (): void => {
      server.close();
      fail(new Error("The start was aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    server.once("error", fail);
    server.listen({ host: http.host, port: http.port }, () => {
      server.off("error", fail);
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw listenFailed(http, new Error("The listener reports no TCP address."));
  }
  return { host: address.address, port: address.port };
}

async function closeListener(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

interface Cell<T> {
  readonly get: () => T;
  readonly set: (next: T) => void;
}

function cell<T>(initial: T): Cell<T> {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}

interface ServerState {
  readonly limits: ServerLimits;
  /** Aborts every running call when the server stops. */
  readonly lifetime: AbortController;
  readonly context: ConnectionContext;
  readonly webSocketServer: WebSocketServer;
  /** Every open connection, at most `maxConnections`. */
  readonly connections: Set<Connection>;
  readonly isAllowedOrigin: Cell<(origin: string | undefined) => boolean>;
  /** The shutdown once `close` was called. */
  readonly closing: Cell<Promise<void> | undefined>;
}

function createState(options: ProtocolServerOptions): ServerState {
  const limits = { ...defaultServerLimits, ...options.limits };
  const lifetime = new AbortController();
  const { clock, random, logger, engine } = options;
  const ids = createIdSource({ clock, random });
  const pushes = createPushHub({ ...limits, clock });
  const writes = createIdempotentWrites({
    store: options.idempotency,
    clock,
    maxInFlight: limits.maxWritesInFlight,
    signal: lifetime.signal,
  });
  const dispatch = createCallDispatch({
    handlers: options.handlers,
    writes,
    pushes,
    description: describeOnce(),
    engine,
    clock,
    ids,
    logger,
    callTimeoutMs: limits.callTimeoutMs,
    signal: lifetime.signal,
  });
  const auth = options.auth === undefined ? {} : { auth: options.auth };
  const signIn = createSignIn({ ...auth, clock, random });
  // The hard cap leaves room to answer a call up to twice the frame limit with a `fail`.
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxFrameBytes * 2,
    perMessageDeflate: false,
    clientTracking: false,
  });
  return {
    limits,
    lifetime,
    context: { dispatch, signIn, pushes, engine, ids, clock, logger, limits },
    webSocketServer,
    connections: new Set(),
    isAllowedOrigin: cell<(origin: string | undefined) => boolean>(() => false),
    closing: cell<Promise<void> | undefined>(undefined),
  };
}

interface Upgrade {
  readonly request: IncomingMessage;
  readonly socket: Duplex;
  readonly head: Buffer;
  readonly transport: Transport;
}

function upgrade(state: ServerState, upgrading: Upgrade): void {
  const { request, socket, transport } = upgrading;
  if (pathOf(request) !== "/ws") {
    refuseUpgrade(socket, 404);
    return;
  }
  if (state.closing.get() !== undefined || state.connections.size >= state.limits.maxConnections) {
    refuseUpgrade(socket, 503);
    return;
  }
  state.webSocketServer.handleUpgrade(request, socket, upgrading.head, (webSocket) => {
    const { origin } = request.headers;
    const peer = {
      transport,
      isOriginAllowed: transport === "ipc" || state.isAllowedOrigin.get()(origin),
      ...(origin === undefined ? {} : { origin }),
    };
    const connection = serveConnection(webSocket, peer, state.context);
    state.connections.add(connection);
    void connection.closed.then(() => state.connections.delete(connection));
  });
}

function createListener(state: ServerState, transport: Transport): Server {
  const server = createServer((request, response) =>
    answerRequest(request, response, state.context.engine.state),
  );
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) =>
    upgrade(state, { request, socket, head, transport }),
  );
  return server;
}

async function shutdown(state: ServerState, listeners: Listeners): Promise<void> {
  state.lifetime.abort();
  const open = [...state.connections];
  open.forEach((connection) => connection.end("engine.stopping", "The engine is stopping."));
  const grace = new AbortController();
  const allClosed = Promise.all(open.map(async (connection) => connection.closed));
  const late = state.context.clock.sleep(state.limits.closeGraceMs, grace.signal).then(
    () => true,
    () => false,
  );
  const isLate = await Promise.race([allClosed.then(() => false), late]);
  grace.abort();
  if (isLate) {
    open.forEach((connection) => connection.terminate());
  }
  await Promise.all([closeListener(listeners.http), closeListener(listeners.ipc)]);
  state.webSocketServer.close();
}

/**
 * Creates the engine's protocol server. It serves the protocol's frames over a WebSocket at `/ws`,
 * on the HTTP listener and on each IPC connection, and `GET /health` on both. Nothing binds until
 * `start`.
 */
export function createProtocolServer(options: ProtocolServerOptions): ProtocolServer {
  const state = createState(options);
  const listeners: Listeners = {
    http: createListener(state, "ws"),
    ipc: createListener(state, "ipc"),
  };
  // Plain HTTP requests, such as health checks, get room beside the WebSocket connections.
  listeners.http.maxConnections = state.limits.maxConnections * 2;
  return {
    async start(signal) {
      const { http } = options;
      if (http === undefined) {
        return undefined;
      }
      checkBind({ host: http.host, hasAuth: options.auth !== undefined });
      const address = await listen(listeners.http, http, signal);
      const extraOrigins = http.extraOrigins ?? [];
      state.isAllowedOrigin.set(createOriginCheck({ port: address.port, extraOrigins }));
      options.logger.info("server.listening");
      return address;
    },
    acceptIpc(socket) {
      if (state.closing.get() === undefined) {
        listeners.ipc.emit("connection", socket);
      } else {
        socket.destroy();
      }
    },
    publish: (event) => state.context.pushes.publish(event),
    async close() {
      const running = state.closing.get() ?? shutdown(state, listeners);
      state.closing.set(running);
      return running;
    },
  };
}
