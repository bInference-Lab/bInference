import type { RelayAnswer } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  createDeadline,
  type Http,
  type HttpResponse,
} from "@binference/core";
import type { Hex } from "viem";
import { z } from "zod";
import { type JsonRpcReply, readJsonRpcReply } from "../rpc/json-rpc-reply.schema.js";
import type { RpcEndpoint } from "../rpc/rpc-call.js";
import { readRelayError } from "./relay-refusal.js";

/** One send of signed bytes to one relay, and the hash the bytes must come back as. */
export interface RelayCall {
  readonly relay: RpcEndpoint;
  readonly raw: Hex;
  readonly hash: Hex;
  readonly signal: AbortSignal;
}

/** What every relay call shares. */
export interface RelayTransport {
  readonly http: Http;
  readonly clock: Clock;
  /** How long a relay may take to answer before its answer is `timed_out`. */
  readonly timeoutMs: number;
}

// Each request goes alone, so one id serves every one.
const requestId = 1;
const hashResultSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
// 48 Club's trouble-shooting page: HTTP 429 is its rate limit.
const rateLimitedStatus = 429;

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function isTimeout(error: Readonly<Error>): boolean {
  return error instanceof BinferenceError && error.code === "core.timeout";
}

// A hash counts only under 2xx, with this request's id, and only as the hash of the bytes sent.
function isOurHash(response: HttpResponse, reply: JsonRpcReply | undefined, call: RelayCall) {
  const hash = hashResultSchema.safeParse(reply !== undefined && "result" in reply && reply.result);
  return (
    isSuccess(response.status) &&
    reply?.id === requestId &&
    hash.success &&
    hash.data.toLowerCase() === call.hash.toLowerCase()
  );
}

// A relay answers a JSON-RPC error under any status, and its rate limit as HTTP 429.
function answerOf(response: HttpResponse, call: RelayCall, atMs: number): RelayAnswer {
  const relay = call.relay.name;
  if (response.status === rateLimitedStatus) {
    return { relay, outcome: "refused", reason: "rate_limited", code: rateLimitedStatus, atMs };
  }
  const reply = readJsonRpcReply(response.body);
  if (reply !== undefined && "error" in reply) {
    const reading = readRelayError(reply.error);
    return reading === "already_known"
      ? { relay, outcome: "accepted", atMs }
      : { relay, outcome: "refused", reason: reading, code: reply.error.code, atMs };
  }
  return isOurHash(response, reply, call)
    ? { relay, outcome: "accepted", atMs }
    : { relay, outcome: "refused", reason: "bad_answer", code: response.status, atMs };
}

/**
 * Sends signed bytes to one relay with `eth_sendRawTransaction`, once, and reads its answer. A
 * relay that does not answer within the timeout is `timed_out`, one that cannot be reached is
 * `unreachable`. Rejects with the caller's reason once the caller's signal aborts.
 */
export async function askRelay(call: RelayCall, transport: RelayTransport): Promise<RelayAnswer> {
  const { relay, raw, signal } = call;
  const { clock } = transport;
  const deadline = createDeadline({ clock, signal, timeoutMs: transport.timeoutMs });
  try {
    const response = await transport.http.request({
      method: "POST",
      url: relay.url,
      headers: { "content-type": "application/json", ...relay.headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "eth_sendRawTransaction",
        params: [raw],
      }),
      signal: deadline.signal,
    });
    return answerOf(response, call, clock.now());
  } catch (error) {
    signal.throwIfAborted();
    const outcome = error instanceof Error && isTimeout(error) ? "timed_out" : "unreachable";
    return { relay: relay.name, outcome, atMs: clock.now() };
  } finally {
    deadline.clear();
  }
}
