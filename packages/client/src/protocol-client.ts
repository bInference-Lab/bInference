import {
  BinferenceError,
  type Clock,
  createIdSource,
  type Logger,
  type Random,
  retry,
  type RetryOptions,
} from "@binference/core";
import {
  type ClientInfo,
  type Credential,
  type EngineFrame,
  type OperationShape,
  type OperationShapes,
  type OperationTable,
  operations as protocolOperations,
  protocolVersion,
  type PushTopic,
  type ReadyFrame,
} from "@binference/protocol";
import {
  type CallContext,
  callOperation,
  type CallOptions,
  type Invocation,
  refuseWhenClosed,
} from "./call-operation.js";
import { clientError } from "./client-error.js";
import { type ClientStatus, createConnectionStatus } from "./connection-status.js";
import { type ClientLimits, defaultClientLimits } from "./default-client-limits.js";
import {
  type Connection,
  type ConnectionOptions,
  type DeviceProver,
  openConnection,
} from "./open-connection.js";
import { createPendingCalls } from "./pending-calls.js";
import type { SocketFactory } from "./protocol-socket.js";
import {
  createPushSubscriptions,
  type PushSubscriptions,
  type TopicHandlers,
} from "./push-subscriptions.js";
import { createStandingCalls, type StandingCalls } from "./standing-calls.js";

/**
 * An operation a caller calls through `call`: every operation of the table but `push/subscribe`
 * and `push/unsubscribe`, which `subscribe` makes itself to keep each topic in `seq` order.
 */
export type CallableName<S> = Exclude<keyof S & string, "push/subscribe" | "push/unsubscribe">;

/** What a client is built from. */
export interface ProtocolClientOptions<
  S extends Readonly<Record<keyof S, OperationShape>> = OperationShapes,
> {
  /** Every operation the client may call: the protocol's `operations`. */
  readonly operations: OperationTable<S>;
  /** Opens a socket to the engine, such as `() => new WebSocket(url)`. */
  readonly openSocket: SocketFactory;
  readonly client: ClientInfo;
  readonly credential: Credential;
  /** Signs the engine's challenge; a console device needs it. */
  readonly proveDevice?: DeviceProver;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
  readonly limits?: Partial<ClientLimits>;
}

/**
 * A typed connection to the engine that reconnects, resends its calls and keeps its pushes. Its
 * calls are typed from the protocol's `OperationShapes`: `ArgsOf` in, `ResultOf` out.
 */
export interface ProtocolClient<
  S extends Readonly<Record<keyof S, OperationShape>> = OperationShapes,
> {
  /**
   * Opens the connection and keeps it open. Resolves at the first `ready`; rejects, and closes the
   * client, when the first connection fails for good or the signal aborts first. A second call
   * returns the first one's promise.
   */
  connect(signal: AbortSignal): Promise<ReadyFrame>;
  /**
   * Calls an operation and resolves with its parsed result. A call made while the socket is down
   * waits for the next connection; a call in flight when the socket drops is sent again, with the
   * same idempotency key. A `subscribe` operation that succeeded, such as `log/follow`, is made
   * again on every new connection. Rejects with the engine's error code from a `fail` frame.
   */
  call<N extends CallableName<S>>(
    op: N,
    args: S[N]["args"],
    options: CallOptions,
  ): Promise<S[N]["result"]>;
  /**
   * Subscribes to a push topic and returns the call that ends the subscription. The topic is
   * loaded once through `refetch`, then its pushes arrive in `seq` order; a gap starts one more
   * refetch. Throws `client.busy` when the topic has a subscriber or `maxTopics` are taken.
   */
  subscribe(topic: PushTopic, handlers: TopicHandlers): () => void;
  /** Where the client stands: idle, connecting, ready with the engine's `ready`, or closed. */
  status(): ClientStatus;
  /**
   * Closes the socket for good and rejects every waiting call with `client.closed`. A closed
   * client refuses new calls with the reason it closed.
   */
  close(): void;
}

interface ClientContext extends CallContext {
  readonly subscriptions: PushSubscriptions;
  readonly standing: StandingCalls;
  readonly lifetime: AbortController;
  readonly logger: Logger;
  readonly reconnect: Omit<RetryOptions, "signal">;
  readonly connectionOptions: ConnectionOptions;
}

function closedError(): BinferenceError {
  return clientError({ code: "client.closed", message: "The client is closed." });
}

// Calls the client makes for itself run for the client's lifetime, with the default timeout.
function background(context: ClientContext): CallOptions {
  return { signal: context.lifetime.signal };
}

function shutdown(context: ClientContext, error: Error): void {
  if (context.lifetime.signal.aborted) {
    return;
  }
  context.lifetime.abort(error);
  context.logger.info("client.closed", {
    errorCode: error instanceof BinferenceError ? error.code : "unexpected",
  });
  const connection = context.status.connection();
  context.status.set({ state: "closed", error });
  context.pending.rejectAll(error);
  context.subscriptions.clear();
  context.standing.clear();
  connection?.close();
}

function route(context: ClientContext, frame: EngineFrame): void {
  switch (frame.t) {
    case "reply":
    case "fail":
      context.pending.answer(frame);
      return;
    case "push":
      context.subscriptions.receive(frame);
      return;
    case "challenge":
    case "ready":
    case "bye":
      return;
  }
}

async function connectOnce(context: ClientContext, signal: AbortSignal): Promise<Connection> {
  context.status.set({ state: "connecting" });
  return retry(async (attempt) => openConnection(context.connectionOptions, attempt.signal), {
    ...context.reconnect,
    signal,
  });
}

// Every call still waiting goes out again on the new connection; a write keeps its key, so the
// engine answers a repeat with its stored result. Subscribe calls hold per-connection state, so
// they are made again.
async function keepConnected(context: ClientContext, connection: Connection): Promise<void> {
  context.status.set({ state: "ready", ready: connection.ready }, connection);
  context.logger.info("client.ready");
  context.pending.frames().forEach((frame) => connection.send(frame));
  context.standing.repeatAll();
  context.subscriptions.resume();
  const reason = await connection.closed;
  if (context.lifetime.signal.aborted || !reason.retryable) {
    shutdown(context, reason);
    return;
  }
  context.logger.warn("client.reconnecting", { errorCode: reason.code });
  let next: Connection;
  try {
    next = await connectOnce(context, context.lifetime.signal);
  } catch (error) {
    shutdown(context, error instanceof Error ? error : reason);
    return;
  }
  return keepConnected(context, next);
}

async function start(context: ClientContext, signal: AbortSignal): Promise<ReadyFrame> {
  try {
    const connection = await connectOnce(
      context,
      AbortSignal.any([context.lifetime.signal, signal]),
    );
    void keepConnected(context, connection);
    return connection.ready;
  } catch (error) {
    shutdown(context, error instanceof Error ? error : closedError());
    throw error;
  }
}

function subscriptionsOf(
  logger: Logger,
  limits: ClientLimits,
  context: () => ClientContext,
): PushSubscriptions {
  return createPushSubscriptions({
    maxTopics: limits.maxTopics,
    logger,
    isConnected: () => context().status.current().state === "ready",
    subscribe: async (args) =>
      callOperation(
        context(),
        { operation: protocolOperations["push/subscribe"], args },
        background(context()),
      ),
    unsubscribe: async (topic) => {
      const request = {
        operation: protocolOperations["push/unsubscribe"],
        args: { topics: [topic] },
      };
      await callOperation(context(), request, background(context()));
    },
  });
}

function createContext<S extends Readonly<Record<keyof S, OperationShape>>>(
  options: ProtocolClientOptions<S>,
): ClientContext {
  const limits: ClientLimits = { ...defaultClientLimits, ...options.limits };
  let calls = 0;
  const context: ClientContext = {
    status: createConnectionStatus(),
    pending: createPendingCalls(limits.maxPendingCalls),
    subscriptions: subscriptionsOf(options.logger, limits, () => context),
    standing: createStandingCalls(options.logger),
    lifetime: new AbortController(),
    limits,
    clock: options.clock,
    logger: options.logger,
    reconnect: { ...limits.reconnect, clock: options.clock, random: options.random },
    ids: createIdSource({ clock: options.clock, random: options.random }),
    nextCallId: () => {
      calls += 1;
      return String(calls);
    },
    connectionOptions: {
      openSocket: options.openSocket,
      open: { t: "open", v: protocolVersion, client: options.client, auth: options.credential },
      ...(options.proveDevice === undefined ? {} : { proveDevice: options.proveDevice }),
      clock: options.clock,
      logger: options.logger,
      timeoutMs: limits.handshakeTimeoutMs,
      onFrame: (frame) => route(context, frame),
    },
  };
  return context;
}

// A subscribe call that succeeded is kept, to be made again on every new connection.
async function callAndKeep<Args, Result>(
  context: ClientContext,
  request: Invocation<Args, Result>,
  options: CallOptions,
): Promise<Result> {
  const result = await callOperation(context, request, options);
  if (request.operation.kind === "subscribe") {
    context.standing.keep(request.operation.name, async () => {
      await callOperation(context, request, background(context));
    });
  }
  return result;
}

/**
 * Creates a protocol client over the protocol's operation table: pass `operations` from
 * `@binference/protocol`. It opens no socket until `connect`. Time, randomness and sockets come
 * through its options, so it runs alike in Node and in browsers.
 */
export function createProtocolClient<
  S extends Readonly<Record<keyof S, OperationShape>> = OperationShapes,
>(options: ProtocolClientOptions<S>): ProtocolClient<S> {
  const context = createContext(options);
  let started: Promise<ReadyFrame> | undefined;
  return {
    async connect(signal) {
      started ??= start(context, signal);
      return started;
    },
    call: async (op, args, callOptions) =>
      callAndKeep(context, { operation: options.operations[op], args }, callOptions),
    subscribe(topic, handlers) {
      refuseWhenClosed(context);
      return context.subscriptions.add(topic, handlers);
    },
    status: () => context.status.current(),
    close: () => shutdown(context, closedError()),
  };
}
