import { outboundRouteOf, type ProxySetting } from "@binference/core";

/** The proxy Playwright starts the browser with: its server, the hosts it skips, its sign-in. */
export interface BrowserProxy {
  readonly server: string;
  readonly bypass?: string;
  readonly username?: string;
  readonly password?: string;
}

/** How the browser reaches the network: directly, through the owner's proxy, or not at all. */
export type BrowserRoute =
  | { readonly kind: "direct" }
  | { readonly kind: "proxy"; readonly proxy: BrowserProxy }
  | { readonly kind: "held" };

// A no-proxy entry as the browser's bypass list reads it: a name also covers the names under it.
function bypassEntries(entry: string): readonly string[] {
  const host = entry.replace(/:\d+$/u, "");
  const isName = /[a-z]/iu.test(host) && !host.includes("/") && !host.startsWith("[");
  return isName ? [entry, `.${entry}`] : [entry];
}

/**
 * The route of the agent's browser from the owner's proxy setting (`network.proxy` and
 * `network.noProxy`, decision 0347): direct without a proxy or with `*` in the no-proxy list,
 * through the proxy with its user name and password apart, as Playwright takes them, and held
 * while the proxy cannot be read or is no proxy URL, so the browser never leaves without it.
 */
export function browserRouteOf(setting: ProxySetting): BrowserRoute {
  const route = outboundRouteOf(setting);
  if (route.kind !== "proxy") {
    return route.kind === "held" ? { kind: "held" } : { kind: "direct" };
  }
  if (setting.noProxy.includes("*")) {
    return { kind: "direct" };
  }
  const url = new URL(route.proxy.reveal());
  const server = `${url.protocol}//${url.host}`;
  const bypass = setting.noProxy.flatMap(bypassEntries).join(",");
  return {
    kind: "proxy",
    proxy: {
      server,
      ...(bypass === "" ? {} : { bypass }),
      ...(url.username === "" ? {} : { username: decodeURIComponent(url.username) }),
      ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
    },
  };
}
