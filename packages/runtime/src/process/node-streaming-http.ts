import {
  answerHeaders,
  BinferenceError,
  type HttpRequest,
  outboundInit,
  throwOutboundFailure,
} from "@binference/core";
// oxlint-disable-next-line eslint/no-restricted-imports -- the runtime's one outbound HTTP adapter: model clients reach the network through the StreamingHttp port
import { Agent, request as send } from "undici";
import type { StreamingHttp } from "../providers/ports.js";
import type { StreamedHttpResponse } from "../providers/streamed-http-response.js";

/** The runtime process's outbound HTTP, with the connection pool it holds. */
export interface NodeStreamingHttp extends StreamingHttp {
  /** Closes the pool's idle connections, so the process can end at once. */
  close(): Promise<void>;
}

/** What the adapter names itself with. */
export interface NodeStreamingHttpOptions {
  /** The running binference's version, which every request names in its `user-agent`. */
  readonly version: string;
}

// The model providers a runtime calls include local ones on the owner's own machine, so it serves
// no request that must reach public addresses only.
function refusePublicOnly(request: HttpRequest): void {
  if (request.publicOnly === true) {
    throw new BinferenceError({
      code: "http.public_only_unsupported",
      message: "The runtime's outbound HTTP does not serve public-only requests.",
      details: { method: request.method, origin: new URL(request.url).origin },
    });
  }
}

async function streamed(
  pool: Agent,
  request: HttpRequest,
  userAgent: string,
): Promise<StreamedHttpResponse> {
  refusePublicOnly(request);
  const answer = await send(request.url, { dispatcher: pool, ...outboundInit(request, userAgent) });
  return { status: answer.statusCode, headers: answerHeaders(answer.headers), body: answer.body };
}

/**
 * The runtime process's outbound HTTP, over undici with a connection pool of its own (undici's
 * own limits: 300 seconds for the headers and between two pieces of a body). It answers as soon
 * as the status and headers arrive, the body streaming, follows no redirect, and answers every
 * status as it came. Every request names binference as `user-agent: binference/<version>`, in
 * place of any user agent the caller set. A request that gets no answer rejects with a retryable
 * `http.unreachable` naming only the method and the origin; one whose signal aborts rejects with
 * the signal's reason. A `publicOnly` request is refused with `http.public_only_unsupported`, and
 * one with two bodies with `http.two_bodies`.
 */
export function createNodeStreamingHttp(options: NodeStreamingHttpOptions): NodeStreamingHttp {
  const pool = new Agent();
  const userAgent = `binference/${options.version}`;
  return {
    async open(request) {
      request.signal.throwIfAborted();
      try {
        return await streamed(pool, request, userAgent);
      } catch (error) {
        return throwOutboundFailure(request, error);
      }
    },
    close: async () => pool.close(),
  };
}
