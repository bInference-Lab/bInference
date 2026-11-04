import { lookup as systemLookup } from "node:dns";
import { type HostLookup, type OutboundRoute, throwOutboundFailure } from "@binference/core";
import { createOutboundPools } from "@binference/platform/outbound";
import type { StreamingHttp } from "../providers/ports.js";

/** The runtime process's outbound HTTP, with the connection pools it holds. */
export interface NodeStreamingHttp extends StreamingHttp {
  /**
   * Puts the route of `network.proxy` and `network.noProxy` in force for every request that
   * starts from now on; one under way finishes as it started.
   */
  use(route: OutboundRoute): void;
  /** Closes the pools' idle connections, so the process can end at once. */
  close(): Promise<void>;
}

/** What the adapter names itself with, and how it looks names up. */
export interface NodeStreamingHttpOptions {
  /** The running binference's version, which every request names in its `user-agent`. */
  readonly version: string;
  /** How a host is looked up; the system's resolver when none is given. */
  readonly lookup?: HostLookup;
  /** The route in force from the start; none refuses every request until `use` (decision 0347). */
  readonly route?: OutboundRoute;
}

/**
 * The runtime process's outbound HTTP, over undici with the connection pools of
 * `@binference/platform/outbound` (undici's own limits: 300 seconds for the headers and between two
 * pieces of a body). It answers as soon as the status and headers arrive, the body streaming,
 * follows no redirect, and answers every status as it came. Every request names binference as
 * `user-agent: binference/<version>`, in place of any user agent the caller set that does not add
 * to it after a space. The model
 * providers a runtime calls include local ones on the owner's own machine, so only a request that
 * asks for it, such as a page the model names, is held to public addresses.
 *
 * Requests go by the route in force, and none goes out before one is (`http.no_route`): through
 * the owner's proxy as a tunnel but for this machine, addresses off the internet and the no-proxy
 * list, and not at all while the proxy set cannot be read (`http.proxy_unusable`). A request that
 * gets no answer rejects with a retryable `http.unreachable` naming only the method and the origin,
 * through the proxy also with `http.proxy_auth`, `http.proxy_refused` or `http.proxy_unreachable`,
 * never naming the proxy, a body that breaks as it streams too; one whose signal aborts rejects
 * with the signal's reason. A direct `publicOnly` request connects only to the public addresses its
 * host resolves to, checked at connect time so a name cannot rebind to a private one. Through the
 * proxy, its name is checked here first; an `http:` one is then sent to the address checked here,
 * so the proxy cannot resolve the name elsewhere, and an `https:` one keeps its name, which TLS
 * binds to the host's certificate. It rejects with `http.private_address` otherwise. One with two
 * bodies rejects with `http.two_bodies`.
 */
export function createNodeStreamingHttp(options: NodeStreamingHttpOptions): NodeStreamingHttp {
  const lookup = options.lookup ?? systemLookup;
  const pools = createOutboundPools({
    lookup,
    lookupAll: options.lookup !== undefined,
    ...(options.route === undefined ? {} : { route: options.route }),
  });
  const userAgent = `binference/${options.version}`;
  return {
    async open(request) {
      request.signal.throwIfAborted();
      try {
        return await pools.send(request, userAgent);
      } catch (cause) {
        return throwOutboundFailure(request, cause);
      }
    },
    use: (route) => pools.use(route),
    close: async () => pools.close(),
  };
}
