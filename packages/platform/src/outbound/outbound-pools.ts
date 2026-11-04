import {
  BinferenceError,
  type HostLookup,
  type HttpRequest,
  type OutboundRoute,
  proxyUnusable,
  publicOnlyLookup,
  refusePrivateAddressHost,
  routeChoiceOf,
  type Secret,
  type SocketLookup,
} from "@binference/core";
// oxlint-disable-next-line eslint/no-restricted-imports -- the connection pools of the outbound HTTP adapters, which alone reach the network
import { Agent, type Dispatcher, ProxyAgent, WebSocket } from "undici";
import { type PickedPool, type SentAnswer, sendPicked } from "./picked-send.js";
import { publicTarget } from "./public-target.js";

/**
 * The connection pools of an outbound HTTP adapter, by the route in force (`network.proxy` and
 * `network.noProxy`, decision 0347): one for any address, one that reaches public addresses only,
 * and one through the owner's proxy. Until a route is put in force, every request and socket is
 * refused (`http.no_route`), so nothing goes out by a route nobody chose.
 */
export interface OutboundPools {
  /**
   * Puts a route in force for every request and socket that starts from now on. A different route
   * closes each WebSocket opened by the old one, so its owner opens it again by the new one, and
   * the old pools close once their requests under way end.
   */
  use(route: OutboundRoute): void;
  /**
   * Sends a request by the route in force with the adapter's `user-agent`, and answers as it
   * comes, its body streaming. Rejects with `http.private_address` as a `publicOnly` request
   * whose host is or resolves to an address off the internet, with `http.proxy_unusable` as a
   * request the held route keeps in, with `http.no_route` before any route is in force, and as
   * through the proxy, naming no proxy, when a request through it fails.
   */
  send(request: HttpRequest, userAgent: string): Promise<SentAnswer>;
  /** Opens a WebSocket by the route in force; throws as `send` refuses. */
  openSocket(url: string): WebSocket;
  close(): Promise<void>;
}

/** What the pools resolve names with, and the route they start with, if any. */
export interface OutboundPoolsOptions {
  /** How a host is looked up: a public-only request's always, any request's when it is given. */
  readonly lookup: HostLookup;
  /** Whether `lookup` also serves the pool for any address, as a test's names do. */
  readonly lookupAll?: boolean;
  /** The route in force from the start; none refuses every request until `use`. */
  readonly route?: OutboundRoute;
}

/** One pool through the proxy, and the proxy URL it was made for. */
interface ProxyPool {
  readonly url: string;
  readonly agent: ProxyAgent;
}

/** The pools of one route, and the sockets opened by it. */
interface RoutePools {
  readonly route: OutboundRoute | undefined;
  readonly any: Agent;
  readonly publicOnly: Agent;
  /** The pool through the proxy, once a request needed it. */
  readonly made: { proxy?: ProxyPool };
  readonly sockets: Set<WebSocket>;
}

/** The pools of the route in force, and the pools of earlier routes while they close. */
interface Pools {
  readonly options: OutboundPoolsOptions;
  readonly state: { current: RoutePools };
  readonly retired: Set<Promise<void>>;
}

// A socket's lookup over a lookup that answers every address, such as a test's names.
function socketLookupOf(lookup: HostLookup): SocketLookup {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      const [first] = addresses;
      if (error !== null || options.all === true || first === undefined) {
        callback(error, [...addresses]);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

function routePoolsOf(options: OutboundPoolsOptions, route: OutboundRoute | undefined): RoutePools {
  const anyConnect =
    options.lookupAll === true ? { connect: { lookup: socketLookupOf(options.lookup) } } : {};
  return {
    route,
    any: new Agent(anyConnect),
    publicOnly: new Agent({ connect: { lookup: publicOnlyLookup(options.lookup) } }),
    made: {},
    sockets: new Set(),
  };
}

// The connection to the proxy is always a tunnel (`CONNECT`), for http: hosts too, so the proxy's
// answer to it is never read as the host's: binference reads a 407 or a 502 as the proxy's alone.
function proxyPoolOf(proxy: Secret): ProxyPool {
  const url = proxy.reveal();
  return { url, agent: new ProxyAgent({ uri: url, proxyTunnel: true }) };
}

function noRoute(request: Pick<HttpRequest, "method" | "url">): BinferenceError {
  return new BinferenceError({
    code: "http.no_route",
    message:
      "No outbound route is in force yet; this is a fault of binference: run binference report.",
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}

// The pool of a request to the URL, and whether it goes through the proxy: refused before a route
// is in force or while the route holds it, the proxy's, made at its first request, or a direct one.
function poolOf(
  pools: RoutePools,
  request: Pick<HttpRequest, "method" | "url" | "publicOnly">,
): { readonly dispatcher: Dispatcher; readonly proxied: boolean } {
  const { route } = pools;
  if (route === undefined) {
    throw noRoute(request);
  }
  const choice = routeChoiceOf(route, request.url);
  if (choice === "held") {
    throw proxyUnusable(request);
  }
  if (choice === "direct" || route.kind !== "proxy") {
    const dispatcher = request.publicOnly === true ? pools.publicOnly : pools.any;
    return { dispatcher, proxied: false };
  }
  const { made } = pools;
  made.proxy ??= proxyPoolOf(route.proxy);
  return { dispatcher: made.proxy.agent, proxied: true };
}

// A route's identity: its kind, its proxy and its no-proxy list.
function routeKey(route: OutboundRoute | undefined): string {
  if (route === undefined || route.kind === "direct") {
    return route?.kind ?? "none";
  }
  const proxy = route.kind === "proxy" ? route.proxy.reveal() : "";
  return JSON.stringify([route.kind, proxy, route.bypass.entries]);
}

// The old route's sockets close, so their owners open them again by the new one; its pools close
// once their requests under way end.
function retire(pools: Pools, old: RoutePools): void {
  for (const socket of old.sockets) {
    socket.close();
  }
  const closing: Promise<void> = Promise.all([
    old.any.close(),
    old.publicOnly.close(),
    old.made.proxy?.agent.close(),
  ])
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => pools.retired.delete(closing));
  pools.retired.add(closing);
}

function useRoute(pools: Pools, route: OutboundRoute): void {
  const { state } = pools;
  const old = state.current;
  if (routeKey(route) === routeKey(old.route)) {
    return;
  }
  state.current = routePoolsOf(pools.options, route);
  if (old.route === undefined) {
    old.any.destroy().catch(() => undefined);
    old.publicOnly.destroy().catch(() => undefined);
    return;
  }
  retire(pools, old);
}

async function pickedOf(pools: Pools, request: HttpRequest): Promise<PickedPool> {
  refusePrivateAddressHost(request);
  const { dispatcher, proxied } = poolOf(pools.state.current, request);
  if (proxied && request.publicOnly === true) {
    return { dispatcher, proxied, ...(await publicTarget(request, pools.options.lookup)) };
  }
  return { dispatcher, proxied, url: request.url };
}

/**
 * Creates the pools of an outbound HTTP adapter. A pool through the proxy is made at its first
 * request, always as a tunnel. A public-only `http:` request through the proxy goes to the public
 * address binference resolved, never to the name, so the proxy cannot connect elsewhere.
 */
export function createOutboundPools(options: OutboundPoolsOptions): OutboundPools {
  const pools: Pools = {
    options,
    state: { current: routePoolsOf(options, options.route) },
    retired: new Set(),
  };
  return {
    use: (route) => useRoute(pools, route),
    send: async (request, userAgent) =>
      sendPicked(request, await pickedOf(pools, request), userAgent),
    openSocket(url) {
      const routed = pools.state.current;
      const { dispatcher } = poolOf(routed, { method: "GET", url });
      const socket = new WebSocket(url, { dispatcher });
      routed.sockets.add(socket);
      socket.addEventListener("close", () => routed.sockets.delete(socket));
      return socket;
    },
    close: async () => {
      const { any, publicOnly, made, sockets } = pools.state.current;
      for (const socket of sockets) {
        socket.close();
      }
      await Promise.all([
        any.close(),
        publicOnly.close(),
        made.proxy?.agent.close(),
        ...pools.retired,
      ]);
    },
  };
}
