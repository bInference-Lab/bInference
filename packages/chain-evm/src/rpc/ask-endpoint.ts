import {
  BinferenceError,
  type Clock,
  createDeadline,
  type Http,
  type HttpResponse,
} from "@binference/core";
import { type JsonRpcError, readJsonRpcReply } from "./json-rpc-reply.schema.js";
import { isNodeFault } from "./node-fault.js";
import type { RpcCall, RpcEndpoint, RpcErrorReply, RpcFault, RpcReply } from "./rpc-call.js";

/** What one endpoint gave a call: a reply, or a failure that sends the call on. */
export type EndpointOutcome<T> =
  | { readonly kind: "reply"; readonly reply: RpcReply<T> }
  | { readonly kind: "fault"; readonly fault: RpcFault };

/** What every attempt shares. */
export interface EndpointTransport {
  readonly http: Http;
  readonly clock: Clock;
  readonly timeoutMs: number;
}

/** One attempt: the endpoint, the call and the JSON-RPC id of this request. */
export interface EndpointAttempt<T> {
  readonly endpoint: RpcEndpoint;
  readonly call: RpcCall<T>;
  readonly id: number;
}

function fault<T>(kind: RpcFault): EndpointOutcome<T> {
  return { kind: "fault", fault: kind };
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function isTimeout(error: Readonly<Error>): boolean {
  return error instanceof BinferenceError && error.code === "core.timeout";
}

function errorOutcome<T>(error: JsonRpcError, endpoint: string): EndpointOutcome<T> {
  if (isNodeFault(error)) {
    return fault("node_error");
  }
  const { code, message, data } = error;
  const reply: RpcErrorReply = {
    kind: "error",
    endpoint,
    code,
    message,
    ...(data === undefined ? {} : { data }),
  };
  return { kind: "reply", reply };
}

// Providers send JSON-RPC errors under 200 or under a 4xx, so an error is read whatever the
// status; a result counts only under 2xx and with this request's id.
function readOutcome<T>(response: HttpResponse, attempt: EndpointAttempt<T>): EndpointOutcome<T> {
  if (response.status === 429 || response.status === 403) {
    return fault("rate_limited");
  }
  const success = isSuccess(response.status);
  const reply = readJsonRpcReply(response.body);
  if (reply !== undefined && "error" in reply) {
    return errorOutcome(reply.error, attempt.endpoint.name);
  }
  if (!success) {
    return fault("bad_status");
  }
  if (reply?.id !== attempt.id) {
    return fault("malformed");
  }
  const parsed = attempt.call.result.safeParse(reply.result);
  return parsed.success
    ? {
        kind: "reply",
        reply: { kind: "result", endpoint: attempt.endpoint.name, value: parsed.data },
      }
    : fault("malformed");
}

/**
 * Sends one call to one endpoint within the timeout. Every failure becomes a fault for the
 * failover to act on; the caller's abort is the failover's to notice.
 */
export async function askEndpoint<T>(
  attempt: EndpointAttempt<T>,
  transport: EndpointTransport,
): Promise<EndpointOutcome<T>> {
  const { endpoint, call, id } = attempt;
  const deadline = createDeadline({
    clock: transport.clock,
    signal: call.signal,
    timeoutMs: transport.timeoutMs,
  });
  try {
    const response = await transport.http.request({
      method: "POST",
      url: endpoint.url,
      headers: { "content-type": "application/json", ...endpoint.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: call.method, params: call.params }),
      signal: deadline.signal,
    });
    return readOutcome(response, attempt);
  } catch (error) {
    return fault(error instanceof Error && isTimeout(error) ? "timeout" : "unreachable");
  } finally {
    deadline.clear();
  }
}
