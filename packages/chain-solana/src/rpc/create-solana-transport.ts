import { BinferenceError, type Clock, createDeadline, type Http } from "@binference/core";
import type { RpcTransport } from "@solana/kit";
import { assertRpcResponse } from "./assert-rpc-response.js";
import {
  type EndpointFault,
  methodOf,
  readSolanaAnswer,
  type SolanaAnswer,
  type SolanaOutcome,
  stringifyRequest,
} from "./solana-answer.schema.js";

/** One Solana RPC endpoint. Its URL may carry a key, so errors name the endpoint only. */
export interface SolanaEndpoint {
  readonly name: string;
  readonly url: string;
}

/** What the transport is built from. */
export interface SolanaTransportOptions {
  /** The endpoints, asked in this order until one answers. */
  readonly endpoints: readonly SolanaEndpoint[];
  readonly http: Http;
  readonly clock: Clock;
  /** How long one endpoint may take to answer before the next one is asked. */
  readonly timeoutMs: number;
}

/** One call through the endpoints: what it sends, what is left to ask, and what failed. */
interface Run {
  readonly method: string;
  readonly body: string;
  readonly signal: AbortSignal;
  readonly queue: readonly SolanaEndpoint[];
  readonly faults: readonly EndpointFault[];
}

// Sends and airdrops change state: a reader never sends them, so a retry never reaches a node.
const writeMethod = /^(?:sendTransaction|requestAirdrop)$/;

function rpcDown(run: Run): BinferenceError {
  return new BinferenceError({
    code: "chain.rpc_down",
    message: `No Solana RPC endpoint answered ${run.method}.`,
    retryable: true,
    details: {
      method: run.method,
      endpoints: run.faults.length,
      faults: run.faults.join(", "),
    },
  });
}

async function ask(
  options: SolanaTransportOptions,
  run: Run,
  endpoint: SolanaEndpoint,
): Promise<SolanaOutcome> {
  const { clock, timeoutMs, http } = options;
  const deadline = createDeadline({ clock, signal: run.signal, timeoutMs });
  try {
    const response = await http.request({
      method: "POST",
      url: endpoint.url,
      headers: { "content-type": "application/json" },
      body: run.body,
      signal: deadline.signal,
    });
    return readSolanaAnswer(response.status, response.body);
  } catch (error) {
    const isTimeout = error instanceof BinferenceError && error.code === "core.timeout";
    return { kind: "fault", fault: isTimeout ? "timeout" : "unreachable" };
  } finally {
    deadline.clear();
  }
}

async function askInTurn(options: SolanaTransportOptions, run: Run): Promise<SolanaAnswer> {
  const [endpoint, ...rest] = run.queue;
  if (endpoint === undefined) {
    throw rpcDown(run);
  }
  const outcome = await ask(options, run, endpoint);
  // The caller's abort ends the call: no other endpoint is asked.
  run.signal.throwIfAborted();
  return outcome.kind === "answer"
    ? outcome.answer
    : askInTurn(options, { ...run, queue: rest, faults: [...run.faults, outcome.fault] });
}

/**
 * Creates the transport Solana's SDK sends its RPC calls through (`createSolanaRpcFromTransport`),
 * over the core `Http` port. It asks the endpoints in turn, each within `timeoutMs`: a timeout, a
 * refused connection, a 429 or 403 (the public endpoints' rate limit), another status outside 2xx,
 * a body that is no JSON-RPC answer, or a node's own JSON-RPC error moves the call to the next
 * one; once every endpoint failed it rejects with a retryable `chain.rpc_down`. A JSON-RPC error
 * about the call itself is its answer, which the SDK throws as a `SolanaError`. Integers come back
 * as `bigint`. Sends and airdrops are refused before any request, and the caller's abort ends the
 * call at once.
 */
export function createSolanaTransport(options: SolanaTransportOptions): RpcTransport {
  if (options.endpoints.length === 0) {
    throw new BinferenceError({
      code: "chain.bad_rpc_endpoints",
      message: "A Solana reader needs at least one RPC endpoint.",
    });
  }
  return async <TResponse>(config: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    const signal = config.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    const method = methodOf(config.payload);
    if (writeMethod.test(method)) {
      throw new BinferenceError({
        code: "chain.rpc_write_refused",
        message: `The Solana reader only reads; ${method} is never sent.`,
        details: { method },
      });
    }
    const body = stringifyRequest(config.payload);
    const run = { method, body, signal, queue: options.endpoints, faults: [] };
    return assertRpcResponse<TResponse>(await askInTurn(options, run));
  };
}
