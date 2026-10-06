import {
  BinferenceError,
  type Clock,
  createDeadline,
  createIdSource,
  type IdSource,
  type Logger,
  type Random,
  retry,
  type RetryOptions,
} from "@binference/core";
import {
  type CallFrame,
  type ClientInfo,
  type Credential,
  type EngineFrame,
  protocolVersion,
  type PushTopic,
  type ReadyFrame,
} from "@binference/protocol";
import { z } from "zod";
import { clientError, errorFromFail } from "./client-error.js";
import {
  type ClientStatus,
  type ConnectionStatus,
  createConnectionStatus,
} from "./connection-status.js";
import { type ClientLimits, defaultClientLimits } from "./default-client-limits.js";
import {
  type Connection,
  type ConnectionOptions,
  type DeviceProver,
  openConnection,
} from "./open-connection.js";
import type {
  OperationArgs,
  OperationContract,
  OperationName,
  OperationResult,
  OperationTable,
  SubscriptionOperations,
} from "./operation-table.js";
import { type CallAnswer, createPendingCalls, type PendingCalls } from "./pending-calls.js";
import type { SocketFactory } from "./protocol-socket.js";
import {
  createPushSubscriptions,
  type PushSubscriptions,
  type TopicHandlers,
} from "./push-subscriptions.js";

/** What a client is built from. */
export interface ProtocolClientOptions<T extends OperationTable<T>> {
  /** Every operation the client may call, with its schemas. */
  readonly operations: T;
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

/** What one call takes besides its args. */
export interface CallOptions {
  readonly signal: AbortSignal;
  /** How long to wait for the answer, across reconnects; the client's `callTimeoutMs` by default. */
  readonly timeoutMs?: number;
  /**
   * The idempotency key of a write. Pass the same key to retry a write after an error; without
   * one, the client makes a key for the call. A read sends no key.
   */
  readonly key?: string;
}

/** A typed connection to the engine that reconnects, resends its calls and keeps its pushes. */
export interface ProtocolClient<T extends OperationTable<T>> {
  /**
   * Opens the connection and keeps it open. Resolves at the first `ready`; rejects, and closes the
   * client, when the first connection fails for good or the signal aborts first. A second call
   * returns the first one's promise.
   */
  connect(signal: AbortSignal): Promise<ReadyFrame>;
  /**
   * Calls an operation and resolves with its parsed result. A call made while the socket is down
   * waits for the next connection; a call in flight when the socket drops is sent again, with the
   * same idempotency key. Rejects with the engine's error code from a `fail` frame.
   */
  call<N extends OperationName<T>>(
    op: N,
    args: OperationArgs<T, N>,
    options: CallOptions,
  ): Promise<OperationResult<T, N>>;
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

interface ClientContext {
  readonly status: ConnectionStatus;
  readonly pending: PendingCalls;
  readonly subscriptions: PushSubscriptions;
  readonly lifetime: AbortController;
  readonly limits: ClientLimits;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly reconnect: Omit<RetryOptions, "signal">;
  readonly ids: IdSource;
  readonly nextCallId: () => string;
  readonly connectionOptions: ConnectionOptions;
}

interface Invocation<C extends OperationContract> {
  readonly op: string;
  readonly contract: C;
  readonly args: z.output<C["args"]>;
}

function closedError(): BinferenceError {
  return clientError({ code: "client.closed", message: "The client is closed." });
}

// A closed client refuses new work with the reason it closed, such as `auth.revoked`.
function refuseWhenClosed(context: ClientContext): void {
  const status = context.status.current();
  if (status.state === "closed") {
    throw status.error;
  }
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
  connection?.close();
}

function settleAnswer<C extends OperationContract>(
  request: Invocation<C>,
  answer: CallAnswer,
): z.output<C["result"]> {
  if (answer.t === "fail") {
    throw errorFromFail(answer.error);
  }
  // An explicit type argument keeps the generic result type; inference would widen it.
  const parsed = z.safeParse<C["result"]>(request.contract.result, answer.result);
  if (!parsed.success) {
    throw clientError({
      code: "client.bad_reply",
      message: `The engine's result for ${request.op} breaks its schema.`,
      details: { op: request.op },
    });
  }
  return parsed.data;
}

async function invoke<C extends OperationContract>(
  context: ClientContext,
  request: Invocation<C>,
  options: CallOptions,
): Promise<z.output<C["result"]>> {
  refuseWhenClosed(context);
  const encoded = z.safeEncode<C["args"]>(request.contract.args, request.args);
  if (!encoded.success) {
    throw new BinferenceError({
      code: "protocol.bad_args",
      message: `The args of ${request.op} break its schema.`,
      details: { op: request.op },
    });
  }
  const frame: CallFrame = {
    t: "call",
    id: context.nextCallId(),
    op: request.op,
    args: encoded.data,
    ...(request.contract.write ? { key: options.key ?? context.ids.next("key") } : {}),
  };
  const timeoutMs = options.timeoutMs ?? context.limits.callTimeoutMs;
  const deadline = createDeadline({ clock: context.clock, signal: options.signal, timeoutMs });
  try {
    const answer = context.pending.wait(frame, deadline.signal);
    context.status.connection()?.send(frame);
    return settleAnswer(request, await answer);
  } finally {
    deadline.clear();
  }
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
// engine answers a repeat with its stored result.
async function keepConnected(context: ClientContext, connection: Connection): Promise<void> {
  context.status.set({ state: "ready", ready: connection.ready }, connection);
  context.logger.info("client.ready");
  context.pending.frames().forEach((frame) => connection.send(frame));
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

function subscriptionsOf<T extends OperationTable<T>>(
  options: ProtocolClientOptions<T>,
  limits: ClientLimits,
  context: () => ClientContext,
): PushSubscriptions {
  const subscribe: SubscriptionOperations["push/subscribe"] = options.operations["push/subscribe"];
  const unsubscribe: SubscriptionOperations["push/unsubscribe"] =
    options.operations["push/unsubscribe"];
  const background = (): CallOptions => ({ signal: context().lifetime.signal });
  return createPushSubscriptions({
    maxTopics: limits.maxTopics,
    logger: options.logger,
    isConnected: () => context().status.current().state === "ready",
    subscribe: async (args) =>
      invoke(context(), { op: "push/subscribe", contract: subscribe, args }, background()),
    unsubscribe: async (topic) => {
      const args = { topics: [topic] };
      await invoke(
        context(),
        { op: "push/unsubscribe", contract: unsubscribe, args },
        background(),
      );
    },
  });
}

function createContext<T extends OperationTable<T>>(
  options: ProtocolClientOptions<T>,
): ClientContext {
  const limits: ClientLimits = { ...defaultClientLimits, ...options.limits };
  let calls = 0;
  const context: ClientContext = {
    status: createConnectionStatus(),
    pending: createPendingCalls(limits.maxPendingCalls),
    subscriptions: subscriptionsOf(options, limits, () => context),
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

/**
 * Creates a protocol client over an operation table. It opens no socket until `connect`. Time,
 * randomness and sockets come through its options, so it runs alike in Node and in browsers.
 */
export function createProtocolClient<T extends OperationTable<T>>(
  options: ProtocolClientOptions<T>,
): ProtocolClient<T> {
  const context = createContext(options);
  let started: Promise<ReadyFrame> | undefined;
  return {
    async connect(signal) {
      started ??= start(context, signal);
      return started;
    },
    call: async (op, args, callOptions) =>
      invoke(context, { op, contract: options.operations[op], args }, callOptions),
    subscribe(topic, handlers) {
      refuseWhenClosed(context);
      return context.subscriptions.add(topic, handlers);
    },
    status: () => context.status.current(),
    close: () => shutdown(context, closedError()),
  };
}
