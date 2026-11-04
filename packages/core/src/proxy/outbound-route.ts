import { BinferenceError } from "../errors/binference-error.js";
import type { HttpRequest } from "../http-exchange.js";
import type { Secret } from "../secret/secret.js";
import { type BypassList, bypassListOf, goesDirect } from "./bypass-list.js";

/**
 * How outbound requests leave this process: all directly when no proxy is set; through the
 * owner's proxy but for the hosts that go direct; or, while a proxy is set that cannot be read or
 * is no proxy URL, never for those hosts, so a request the owner meant for the proxy never leaves
 * without it.
 */
export type OutboundRoute =
  | { readonly kind: "direct" }
  | { readonly kind: "proxy"; readonly proxy: Secret; readonly bypass: BypassList }
  | { readonly kind: "held"; readonly bypass: BypassList };

/** The route of one request: directly, through the proxy, or refused while the proxy is held. */
export type RouteChoice = OutboundRoute["kind"];

/** What `network.proxy` and `network.noProxy` hold, the proxy read from its secret source. */
export interface ProxySetting {
  /** The proxy URL; `unread` when its secret source had none; absent when none is set. */
  readonly proxy?: Secret | "unread";
  readonly noProxy: readonly string[];
}

/** The route of every request when no proxy is set. */
export const directRoute: OutboundRoute = { kind: "direct" };

/**
 * Whether a URL can name the proxy: `http:` or `https:`, a host, and nothing after it but `/`. A
 * user name and password in it are the proxy's credentials.
 */
export function isProxyUrl(text: string): boolean {
  if (!URL.canParse(text)) {
    return false;
  }
  const url = new URL(text);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.hostname !== "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

/**
 * The route a proxy setting gives: direct without a proxy, through it with the no-proxy list, and
 * held when its secret could not be read or is no proxy URL ({@link isProxyUrl}).
 */
export function outboundRouteOf(setting: ProxySetting): OutboundRoute {
  const { proxy } = setting;
  if (proxy === undefined) {
    return directRoute;
  }
  const bypass = bypassListOf(setting.noProxy);
  return proxy !== "unread" && isProxyUrl(proxy.reveal())
    ? { kind: "proxy", proxy, bypass }
    : { kind: "held", bypass };
}

/** Which way a request to the URL goes on the route; this machine is always reached directly. */
export function routeChoiceOf(route: OutboundRoute, url: string): RouteChoice {
  return route.kind === "direct" || goesDirect(route.bypass, url) ? "direct" : route.kind;
}

/**
 * Refuses a request the held route keeps in, with `http.proxy_unusable`: the proxy config names
 * cannot be read or is no proxy URL. It names the method and the request's origin, never the
 * proxy.
 */
export function proxyUnusable(request: Pick<HttpRequest, "method" | "url">): BinferenceError {
  return new BinferenceError({
    code: "http.proxy_unusable",
    message:
      "network.proxy names a proxy that cannot be read or is no http or https URL; run binference check.",
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}
