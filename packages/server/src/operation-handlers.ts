import type { Result } from "@binference/core";
import type {
  ArgsOf,
  ClientInfo,
  OperationName,
  ProtocolErrorCode,
  ProtocolId,
  ResultOf,
  Scope,
} from "@binference/protocol";

/**
 * Where a connection came in: `ipc`, the local socket or named pipe the platform binds, or `ws`,
 * the HTTP listener's WebSocket. Client tokens sign in over IPC only, console devices over WS only,
 * and a `local` operation runs over IPC only.
 */
export type Transport = "ipc" | "ws";

/** Who makes a call: the signed-in connection, its credential and the scopes it holds. */
export interface Caller {
  readonly connection: ProtocolId<"connection">;
  /**
   * The credential's id, never its secret: a client token's `tok_` id or a console device's `dev_`
   * id. Idempotency keys are kept per credential.
   */
  readonly credential: string;
  readonly client: ClientInfo;
  readonly scopes: readonly Scope[];
  readonly transport: Transport;
}

/** One checked call as its handler receives it. */
export interface HandlerCall<N extends OperationName> {
  /** The args after the operation's schema parsed them, so amounts are `bigint`. */
  readonly args: ArgsOf<N>;
  /**
   * Who calls. An operation with a scope case, such as `limit/set`, reaches its handler when the
   * caller holds either scope; the handler decides the case and checks `caller.scopes` for it.
   */
  readonly caller: Caller;
  /**
   * Aborts when the call runs out of time or the server stops. A read's signal also aborts when
   * its connection closes; a write runs on, so a client that sends it again after a reconnect gets
   * its result.
   */
  readonly signal: AbortSignal;
}

/**
 * Answers one operation with its result, or refuses it with a protocol error code, such as
 * `intent.not_found`, for an expected outcome. The server encodes the result with the operation's
 * schema. A refused write stores nothing, so the same key may run again. A handler that needs to
 * send details throws a `BinferenceError` with a protocol code; any other throw reaches the client
 * as `internal.error`.
 */
export type OperationHandler<N extends OperationName> = (
  call: HandlerCall<N>,
) => Promise<Result<ResultOf<N>, ProtocolErrorCode>>;

/**
 * The operation handlers by name, filled by the engine and the agent runtime. A call of an
 * operation without a handler fails with `runtime.unavailable` when the runtime answers it, and
 * with `protocol.unknown_op` when the engine does. The server answers `push/subscribe`,
 * `push/unsubscribe` and `engine/describe` itself and never reads a handler for them.
 */
export type OperationHandlers = { readonly [N in OperationName]?: OperationHandler<N> };
