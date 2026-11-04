import {
  BinferenceError,
  type Http,
  isProxyUrl,
  type Logger,
  type OutboundRoute,
  outboundRouteOf,
  type ProxySetting,
  routeChoiceOf,
} from "@binference/core";
import type { ProxyUse } from "@binference/engine/audit";
import type { NetworkConfig } from "../config/schema/operations.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import type { OutboundSwitch } from "../runtime/system-http.js";
import { probeProxy, proxyProbeUrl } from "./proxy-probe.js";

/**
 * The owner's proxy setting as the engine holds it, read from `network.proxy`'s secret source,
 * and put in force for the engine's outbound requests.
 */
export interface ProxyCell {
  /** The setting in force, which the agent runtime's settings carry. */
  current(): ProxySetting;
  /**
   * Reads `network` again after a reload changed a key under it, puts it in force for every
   * request and socket that starts from then on, and sends one request through the proxy: answers
   * how the proxy failed that first use, or nothing when it carried it or nothing changed.
   */
  follow(changed: readonly string[], signal: AbortSignal): Promise<ProxyUse | undefined>;
}

/** What the proxy setting is read with, and where it goes. */
export interface ProxyCellOptions {
  /** `network` as config holds it now, reloads included. */
  readonly network: () => NetworkConfig;
  readonly secrets: SecretReader;
  /** The engine's outbound adapter, and its requests for the first use after a change. */
  readonly outbound: OutboundSwitch;
  readonly http: Http;
  readonly logger: Logger;
}

// The proxy URL never reaches a log: a setting that cannot be used is logged by its code alone.
async function readSetting(options: ProxyCellOptions, signal: AbortSignal): Promise<ProxySetting> {
  const { proxy, noProxy } = options.network();
  if (proxy === undefined) {
    return { noProxy };
  }
  try {
    const read = await options.secrets.read("network.proxy", proxy, signal);
    if (!isProxyUrl(read.reveal())) {
      options.logger.warn("network.proxy_held", { errorCode: "http.proxy_unusable" });
    }
    return { proxy: read, noProxy };
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("network.proxy_held", { errorCode });
    return { proxy: "unread", noProxy };
  }
}

// The first use of a changed route: held, or one request to Telegram when it goes through the
// proxy; a direct route, or one that sends Telegram direct, has nothing of the proxy to try.
async function firstUse(
  http: Http,
  route: OutboundRoute,
  signal: AbortSignal,
): Promise<ProxyUse | undefined> {
  if (route.kind === "held") {
    return "held";
  }
  if (routeChoiceOf(route, proxyProbeUrl) !== "proxy") {
    return undefined;
  }
  return (await probeProxy(http, signal)).problem;
}

const isNetworkKey = (path: string): boolean => path === "network" || path.startsWith("network.");

/**
 * Reads `network.proxy` from its secret source and `network.noProxy`, and puts their route in
 * force on the engine's outbound adapter before any other part reaches the network (decision
 * 0347). A proxy that cannot be read, or is no `http:` or `https:` URL, holds every request it
 * would carry (`http.proxy_unusable`) and is logged as `network.proxy_held` with its code, never
 * its source or value. A reload that changes a key under `network` reads and applies it again (decision 0230)
 * and tries the proxy once, so the reload's notice can say it failed.
 */
export async function openProxyCell(
  options: ProxyCellOptions,
  signal: AbortSignal,
): Promise<ProxyCell> {
  const held = { setting: await readSetting(options, signal) };
  options.outbound.use(outboundRouteOf(held.setting));
  return {
    current: () => held.setting,
    async follow(changed, reading) {
      if (!changed.some(isNetworkKey)) {
        return undefined;
      }
      held.setting = await readSetting(options, reading);
      const route = outboundRouteOf(held.setting);
      options.outbound.use(route);
      return firstUse(options.http, route, reading);
    },
  };
}
