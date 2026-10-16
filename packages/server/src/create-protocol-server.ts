import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  type ErrorCode,
  type Logger,
  type Random,
} from "@binference/core";
import type { IdempotencyStore } from "@binference/engine";
import type { AuthLockoutReport, DevicePairing } from "@binference/engine/access";
import type { UploadShelf } from "@binference/engine/chat";
import type { PushFrame } from "@binference/protocol";
import { WebSocketServer } from "ws";
import { createAuthFailures } from "./auth-failures.js";
import { createCallDispatch } from "./call-dispatch.js";
import { checkBind } from "./check-bind.js";
import type { ConnectionContext } from "./connection-link.js";
import type { ConsoleFiles } from "./console-route.js";
import type { EngineFacts } from "./engine-facts.js";
import { answerRequest, pathOf, refuseUpgrade, sourceOf } from "./http-routes.js";
import { createIdempotentWrites } from "./idempotent-writes.js";
import { createLockoutAlerts } from "./lockout-alerts.js";
import type { OperationHandlers, Transport } from "./operation-handlers.js";
import { closedOriginRules, createOriginRules, type OriginRules } from "./origin-check.js";
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
  /**
   * The HTTPS origin a tunnel publishes the listener at (config `remote.publicUrl`): it opens
   * `/ws` and the console's files; `POST /pair` and `GET /health` answer 404 through it.
   */
  readonly publicOrigin?: string;
}

/** What a protocol server is built from. */
export interface ProtocolServerOptions {
  /** The HTTP listener; without it the server serves IPC only. */
  readonly http?: HttpListenOptions;
  /** What sign-ins are checked against; without it every sign-in fails with `auth.required`. */
  readonly auth?: ServerAuth;
  /** Pairs console devices at `POST /pair` on the HTTP listener; without it the path is 404. */
  readonly pairing?: DevicePairing;
  /** The console's built files, served on the HTTP listener at `/` and `/mini`. */
  readonly consoleFiles?: ConsoleFiles;
  /** Takes the owner's images at `POST /upload/:ticket`; without it the path is 404. */
  readonly uploads?: Pick<UploadShelf, "receive">;
  /** Where each write's result is kept under its idempotency key. */
  readonly idempotency: IdempotencyStore;
  readonly handlers: OperationHandlers;
  readonly engine: EngineFacts;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
  readonly limits?: Partial<ServerLimits>;
  /**
   * Hears each lockout that failed sign-ins or pairings set, at most once per source or
   * credential within `authAlertEveryMs`, to tell the owner; it must not throw.
   */
  readonly onLockout?: (lockout: AuthLockoutReport) => void;
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
   * Ends every connection signed in with the credential, or proving it, with `bye` and the code,
   * such as `auth.revoked` once a device is revoked.
   */
  endSessions(credential: string, code: ErrorCode): void;
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
  readonly origins: Cell<OriginRules>;
  /** The shutdown once `close` was called. */
  readonly closing: Cell<Promise<void> | undefined>;
}

// The hard cap leaves room to answer a call up to twice the frame limit with a `fail`.
function webSocketServerOf(limits: ServerLimits): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxFrameBytes * 2,
    perMessageDeflate: false,
    clientTracking: false,
  });
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
  const failures = createAuthFailures({ ...limits, clock });
  const report = options.onLockout === undefined ? {} : { report: options.onLockout };
  const alerts = createLockoutAlerts({ ...limits, clock, ...report });
  return {
    limits,
    lifetime,
    context: { dispatch, signIn, pushes, engine, ids, clock, logger, limits, failures, alerts },
    webSocketServer: webSocketServerOf(limits),
    connections: new Set(),
    origins: cell<OriginRules>(closedOriginRules),
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
      source: transport === "ipc" ? "ipc" : sourceOf(request),
      isOriginAllowed: transport === "ipc" || state.origins.get().isSocketOrigin(origin),
      ...(origin === undefined ? {} : { origin }),
    };
    const connection = serveConnection(webSocket, peer, state.context);
    state.connections.add(connection);
    void connection.closed.then(() => state.connections.delete(connection));
  });
}

interface ListenerOptions {
  readonly transport: Transport;
  /** The browser routes of the HTTP listener: pairing, uploads and the console's files. */
  readonly browser?: Pick<ProtocolServerOptions, "pairing" | "consoleFiles" | "uploads">;
}

function createListener(state: ServerState, options: ListenerOptions): Server {
  const { transport } = options;
  const server = createServer((request, response) =>
    answerRequest(request, response, {
      ...options.browser,
      state: state.context.engine.state,
      origins: () => state.origins.get(),
      failures: state.context.failures,
      alerts: state.context.alerts,
      logger: state.context.logger,
      signal: state.lifetime.signal,
    }),
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
  const { pairing, consoleFiles, uploads } = options;
  const browser = {
    ...(pairing === undefined ? {} : { pairing }),
    ...(consoleFiles === undefined ? {} : { consoleFiles }),
    ...(uploads === undefined ? {} : { uploads }),
  };
  const listeners: Listeners = {
    http: createListener(state, { transport: "ws", browser }),
    ipc: createListener(state, { transport: "ipc" }),
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
      const publicOrigin =
        http.publicOrigin === undefined ? {} : { publicOrigin: http.publicOrigin };
      state.origins.set(createOriginRules({ port: address.port, extraOrigins, ...publicOrigin }));
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
    endSessions(credential, code) {
      for (const connection of state.connections) {
        if (connection.credential() === credential) {
          connection.end(code, "The credential was revoked.");
        }
      }
    },
    async close() {
      const running = state.closing.get() ?? shutdown(state, listeners);
      state.closing.set(running);
      return running;
    },
  };
}
