import { BinferenceError, type Http, type HttpRequest, type HttpResponse } from "@binference/core";
import { z } from "zod";
import { type JsonValue, jsonParamsSchema } from "../rpc/json-value.schema.js";

/** How a fake endpoint behaves: it answers, holds every request until its signal aborts, or refuses. */
export type FakeEndpoint = ((request: HttpRequest) => HttpResponse) | "hang" | "refuse";

/** What a fake JSON-RPC node answers for one call. */
export type FakeRpcAnswer =
  | { readonly result: JsonValue }
  | {
      readonly error: {
        readonly code: number;
        readonly message: string;
        readonly data?: JsonValue;
      };
    }
  | { readonly status: number; readonly body: string };

/** One JSON-RPC request a fake node received. */
export interface FakeRpcRequest {
  readonly id: number;
  readonly method: string;
  readonly params: readonly JsonValue[];
}

/** An Http adapter for tests whose endpoints answer, hang or refuse, with no network. */
export interface FakeRpcHttp extends Http {
  /** The requests it received, oldest first; past 1,000 the oldest is dropped. */
  requests(): readonly HttpRequest[];
}

const maxRequests = 1_000;

const requestSchema = z.object({ id: z.int(), method: z.string(), params: jsonParamsSchema });

function unreachable(): BinferenceError {
  return new BinferenceError({
    code: "http.unreachable",
    message: "The fake endpoint refuses connections.",
    retryable: true,
  });
}

function holdUntilAbort(signal: AbortSignal): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Reads the JSON-RPC request a fake node received in an HTTP body. */
export function readFakeRpcRequest(body: string | undefined): FakeRpcRequest {
  return requestSchema.parse(JSON.parse(body ?? "null"));
}

/** A fake endpoint that answers each JSON-RPC request with this request's id. */
export function fakeRpcNode(answer: (request: FakeRpcRequest) => FakeRpcAnswer): FakeEndpoint {
  return (request) => {
    const call = readFakeRpcRequest(request.body);
    const reply = answer(call);
    if ("status" in reply) {
      return { status: reply.status, headers: {}, body: reply.body };
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({ jsonrpc: "2.0", id: call.id, ...reply }),
    };
  };
}

/**
 * Creates a {@link FakeRpcHttp} with an endpoint per URL. A URL without one refuses, as a port with
 * nothing listening does.
 */
export function createFakeRpcHttp(endpoints: Readonly<Record<string, FakeEndpoint>>): FakeRpcHttp {
  const received: HttpRequest[] = [];
  return {
    async request(request) {
      request.signal.throwIfAborted();
      received.push(request);
      if (received.length > maxRequests) {
        received.shift();
      }
      const endpoint = endpoints[request.url] ?? "refuse";
      if (endpoint === "hang") {
        return holdUntilAbort(request.signal);
      }
      if (endpoint === "refuse") {
        throw unreachable();
      }
      return endpoint(request);
    },
    requests: () => [...received],
  };
}
