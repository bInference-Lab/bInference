import type { z } from "zod";
import type { JsonValue } from "./json-value.schema.js";

/** One RPC endpoint. Its URL may carry a key, so errors and health name the endpoint only. */
export interface RpcEndpoint {
  /** A short name for health and errors, such as the chain file's endpoint name. */
  readonly name: string;
  readonly url: string;
  /** Extra headers, such as a provider's key sent as a header instead of in the URL. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** One JSON-RPC request through the failover. */
export interface RpcCall<T> {
  readonly method: string;
  readonly params: readonly JsonValue[];
  /** Checks the result. A result that fails it counts against the endpoint that sent it. */
  readonly result: z.ZodType<T>;
  readonly signal: AbortSignal;
}

/** A result the node answered, checked by the call's schema. */
export interface RpcResultReply<T> {
  readonly kind: "result";
  /** The endpoint that answered. */
  readonly endpoint: string;
  readonly value: T;
}

/**
 * A JSON-RPC error the node answered for the call itself, such as a revert or bad params. Asking
 * another endpoint would get the same answer, so the failover returns it.
 */
export interface RpcErrorReply {
  readonly kind: "error";
  /** The endpoint that answered. */
  readonly endpoint: string;
  readonly code: number;
  readonly message: string;
  readonly data?: JsonValue;
}

/** What an endpoint answered: a result or a JSON-RPC error. */
export type RpcReply<T> = RpcResultReply<T> | RpcErrorReply;

/**
 * Why an endpoint failed a call and the next one was asked:
 * - `timeout`: no answer within the timeout;
 * - `unreachable`: the request never got an HTTP answer;
 * - `rate_limited`: HTTP 429, or 403, which BNB Chain's public nodes send for bursts;
 * - `bad_status`: another HTTP status outside 2xx;
 * - `malformed`: an answer that is not a JSON-RPC reply, or a result that fails its schema;
 * - `node_error`: a JSON-RPC error that says the node, not the call, failed;
 * - `missing_state`: a JSON-RPC error that says the node no longer holds the state the call reads,
 *   such as an old block's a node that prunes has dropped. The node stays healthy.
 */
export type RpcFault =
  | "timeout"
  | "unreachable"
  | "rate_limited"
  | "bad_status"
  | "malformed"
  | "node_error"
  | "missing_state";

/** One endpoint's state, for health signals. */
export interface EndpointHealth {
  readonly name: string;
  /** While the clock is before this time, the endpoint is asked only after the healthy ones. */
  readonly restingUntilMs?: number;
  /** The last failure, until the endpoint answers again. */
  readonly lastFault?: RpcFault;
}

/** Sends JSON-RPC requests to a chain's endpoints, moving to the next when one fails. */
export interface RpcFailover {
  /**
   * Asks the endpoints in turn until one answers. Rejects with a retryable `chain.rpc_down` when
   * none does, and with the signal's reason once it aborts.
   */
  request<T>(call: RpcCall<T>): Promise<RpcReply<T>>;
  /** Each endpoint's state, in the configured order. */
  health(): readonly EndpointHealth[];
}
