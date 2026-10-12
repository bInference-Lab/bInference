import { BinferenceError, type Clock, type Http } from "@binference/core";
import { askEndpoint, type EndpointTransport } from "./ask-endpoint.js";
import { createEndpointBook, type EndpointBook } from "./endpoint-book.js";
import type { RpcCall, RpcEndpoint, RpcFailover, RpcFault, RpcReply } from "./rpc-call.js";

/** What a failover is built from. */
export interface RpcFailoverOptions {
  /** The endpoints, asked in this order while they are healthy. */
  readonly endpoints: readonly RpcEndpoint[];
  readonly http: Http;
  readonly clock: Clock;
  /** How long one endpoint may take to answer before the next one is asked. */
  readonly timeoutMs: number;
  /** How long a failed endpoint rests: it is asked only after the healthy ones until then. */
  readonly restMs: number;
}

interface FailoverRun<T> {
  readonly call: RpcCall<T>;
  readonly id: number;
  readonly queue: readonly RpcEndpoint[];
  readonly faults: readonly RpcFault[];
}

interface FailoverParts {
  readonly book: EndpointBook;
  readonly transport: EndpointTransport;
}

// The failover reads; private relays send. A send retried on another endpoint after a timeout
// could reach the public mempool, so no write or signing method passes here.
const writeMethod = /^(?:eth_send|eth_sign|personal_|wallet_)/;

function rpcDown(method: string, faults: readonly RpcFault[]): BinferenceError {
  return new BinferenceError({
    code: "chain.rpc_down",
    message: `No RPC endpoint answered ${method}.`,
    retryable: true,
    details: { method, endpoints: faults.length, lastFault: faults.at(-1) ?? "none" },
  });
}

function stateMissing(method: string, faults: readonly RpcFault[]): BinferenceError {
  return new BinferenceError({
    code: "chain.state_missing",
    message: `No RPC endpoint still holds the state ${method} reads.`,
    details: { method, endpoints: faults.length },
  });
}

function blockAhead(method: string, faults: readonly RpcFault[]): BinferenceError {
  return new BinferenceError({
    code: "chain.block_ahead",
    message: `No RPC endpoint has imported the block ${method} reads yet.`,
    retryable: true,
    details: { method, endpoints: faults.length },
  });
}

const everyFault = (faults: readonly RpcFault[], kind: RpcFault): boolean =>
  faults.length > 0 && faults.every((fault) => fault === kind);

// Every endpoint answered that it pruned the state: asking again later cannot help. Every endpoint
// answered that it has not imported the block yet: asking again in a moment will.
function exhausted(method: string, faults: readonly RpcFault[]): BinferenceError {
  if (everyFault(faults, "missing_state")) {
    return stateMissing(method, faults);
  }
  return everyFault(faults, "not_yet") ? blockAhead(method, faults) : rpcDown(method, faults);
}

// Healthy endpoints first, the preferred one before them while it is healthy.
function queueFor(book: EndpointBook, prefer: string | undefined): readonly RpcEndpoint[] {
  const inTurn = book.inTurn();
  const preferred = inTurn.find((endpoint) => endpoint.name === prefer);
  const isHealthy = preferred !== undefined && !book.isResting(preferred);
  return isHealthy ? [preferred, ...inTurn.filter((endpoint) => endpoint !== preferred)] : inTurn;
}

function validate(endpoints: readonly RpcEndpoint[]): void {
  const names = new Set(endpoints.map((endpoint) => endpoint.name));
  if (endpoints.length === 0 || names.size !== endpoints.length) {
    throw new BinferenceError({
      code: "chain.bad_rpc_endpoints",
      message: "An RPC failover needs at least one endpoint, each with its own name.",
      details: { endpoints: endpoints.length },
    });
  }
}

async function askInTurn<T>(run: FailoverRun<T>, parts: FailoverParts): Promise<RpcReply<T>> {
  const [endpoint, ...rest] = run.queue;
  if (endpoint === undefined) {
    throw exhausted(run.call.method, run.faults);
  }
  const outcome = await askEndpoint({ endpoint, call: run.call, id: run.id }, parts.transport);
  // The caller's abort ends the call: no other endpoint is asked.
  run.call.signal.throwIfAborted();
  if (outcome.kind === "reply") {
    parts.book.settle(endpoint, undefined);
    return outcome.reply;
  }
  // A node that pruned an old block's state still answers everything newer, and one that has not
  // imported the newest block yet is no less healthy for it.
  const isHealthy = outcome.fault === "missing_state" || outcome.fault === "not_yet";
  parts.book.settle(endpoint, isHealthy ? undefined : outcome.fault);
  return askInTurn({ ...run, queue: rest, faults: [...run.faults, outcome.fault] }, parts);
}

/**
 * Creates the failover over a chain's RPC endpoints. Each endpoint gets `timeoutMs` to answer;
 * a timeout, a refused connection, an HTTP error, a malformed reply or a node failure moves the
 * call to the next endpoint and rests the failed one for `restMs`. A JSON-RPC error about the call
 * itself, such as a revert, is a reply. When every endpoint answers that it pruned the state the
 * call reads, the call fails with `chain.state_missing`, which no retry mends; when every endpoint
 * answers a call at the head that it has not imported the block yet, with a retryable
 * `chain.block_ahead`, and no endpoint rests for it; any other failure of every endpoint is a
 * retryable `chain.rpc_down`. A call may name an endpoint to ask first while it is healthy. Write and signing methods are refused, since a
 * retried send must never reach a public node.
 */
export function createRpcFailover(options: RpcFailoverOptions): RpcFailover {
  validate(options.endpoints);
  const parts: FailoverParts = { book: createEndpointBook(options), transport: options };
  let nextId = 1;
  return {
    async request<T>(call: RpcCall<T>): Promise<RpcReply<T>> {
      if (writeMethod.test(call.method)) {
        throw new BinferenceError({
          code: "chain.rpc_write_refused",
          message: `The RPC failover only reads; ${call.method} goes through the send path.`,
          details: { method: call.method },
        });
      }
      call.signal.throwIfAborted();
      const id = nextId;
      nextId += 1;
      return askInTurn(
        { call, id, queue: queueFor(parts.book, call.preferEndpoint), faults: [] },
        parts,
      );
    },
    health: () => parts.book.health(),
  };
}
