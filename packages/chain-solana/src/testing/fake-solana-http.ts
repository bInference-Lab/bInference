import {
  BinferenceError,
  type Http,
  type HttpRequest,
  type HttpResponse,
  type JsonValue,
  jsonValueSchema,
} from "@binference/core";
import { z } from "zod";

/** One JSON-RPC call a fake Solana node received. */
export interface FakeSolanaCall {
  readonly method: string;
  readonly params: readonly JsonValue[];
}

/** How a fake Solana node answers one call with its id. */
type FakeSolanaAnswer = (call: FakeSolanaCall, id: string) => HttpResponse;

/** What a fake endpoint does: answer each call, refuse the connection, or hold the request. */
export type FakeSolanaEndpoint = FakeSolanaAnswer | "refuse" | "hang";

/** An Http adapter for tests whose Solana endpoints answer, refuse or hang, with no network. */
export interface FakeSolanaHttp extends Http {
  /** The JSON-RPC calls each URL received, oldest first. */
  calls(url: string): readonly FakeSolanaCall[];
}

const requestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.array(jsonValueSchema).default([]),
});

/** A JSON-RPC answer to a call, with its id. */
export function jsonRpcAnswer(id: string, answer: object, status = 200): HttpResponse {
  return { status, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id, ...answer }) };
}

function hold(signal: AbortSignal): Promise<HttpResponse> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function refused(): BinferenceError {
  return new BinferenceError({
    code: "http.unreachable",
    message: "The fake endpoint refuses connections.",
    retryable: true,
  });
}

/** Creates a {@link FakeSolanaHttp} with an endpoint per URL; a URL without one refuses. */
export function createFakeSolanaHttp(
  endpoints: Readonly<Record<string, FakeSolanaEndpoint>>,
): FakeSolanaHttp {
  const received = new Map<string, FakeSolanaCall[]>();
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      request.signal.throwIfAborted();
      // A request that is no JSON-RPC call, such as the Http suite's, reaches its endpoint as an
      // empty call.
      const parsed = requestSchema.safeParse(JSON.parse(request.body ?? "null"));
      const { id, method, params } = parsed.success
        ? parsed.data
        : { id: "", method: "", params: [] };
      if (parsed.success) {
        received.set(request.url, [...(received.get(request.url) ?? []), { method, params }]);
      }
      const endpoint = endpoints[request.url] ?? "refuse";
      if (endpoint === "hang") {
        return hold(request.signal);
      }
      if (endpoint === "refuse") {
        throw refused();
      }
      return await Promise.resolve(endpoint({ method, params }, id));
    },
    calls: (url) => received.get(url) ?? [],
  };
}
