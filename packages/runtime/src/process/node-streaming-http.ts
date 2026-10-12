import { lookup as systemLookup } from "node:dns";
import {
  answerHeaders,
  type HostLookup,
  type HttpRequest,
  outboundInit,
  publicOnlyLookup,
  refusePrivateAddressHost,
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
  /** How a public-only request's host is looked up; the system's resolver when none is given. */
  readonly lookup?: HostLookup;
}

/** The connection pools: one for any address, one that reaches public addresses only. */
interface Pools {
  readonly any: Agent;
  readonly publicOnly: Agent;
}

// The model providers a runtime calls include local ones on the owner's own machine, so only a
// request that asks for it, such as a page the model names, is held to public addresses.
function poolFor(pools: Pools, request: HttpRequest): Agent {
  refusePrivateAddressHost(request);
  return request.publicOnly === true ? pools.publicOnly : pools.any;
}

async function streamed(
  pools: Pools,
  request: HttpRequest,
  userAgent: string,
): Promise<StreamedHttpResponse> {
  const dispatcher = poolFor(pools, request);
  const answer = await send(request.url, { dispatcher, ...outboundInit(request, userAgent) });
  return { status: answer.statusCode, headers: answerHeaders(answer.headers), body: answer.body };
}

/**
 * The runtime process's outbound HTTP, over undici with a connection pool of its own (undici's
 * own limits: 300 seconds for the headers and between two pieces of a body). It answers as soon
 * as the status and headers arrive, the body streaming, follows no redirect, and answers every
 * status as it came. Every request names binference as `user-agent: binference/<version>`, in
 * place of any user agent the caller set. A request that gets no answer rejects with a retryable
 * `http.unreachable` naming only the method and the origin; one whose signal aborts rejects with
 * the signal's reason. A `publicOnly` request connects only to the public addresses its host
 * resolves to, checked at connect time so a name cannot rebind to a private one after an earlier
 * check, and rejects with `http.private_address` otherwise. One with two bodies rejects with
 * `http.two_bodies`.
 */
export function createNodeStreamingHttp(options: NodeStreamingHttpOptions): NodeStreamingHttp {
  const lookup = publicOnlyLookup(options.lookup ?? systemLookup);
  const pools = { any: new Agent(), publicOnly: new Agent({ connect: { lookup } }) };
  const userAgent = `binference/${options.version}`;
  return {
    async open(request) {
      request.signal.throwIfAborted();
      try {
        return await streamed(pools, request, userAgent);
      } catch (error) {
        return throwOutboundFailure(request, error);
      }
    },
    close: async () => {
      await Promise.all([pools.any.close(), pools.publicOnly.close()]);
    },
  };
}
