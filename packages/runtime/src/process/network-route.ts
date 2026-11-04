import { createSecret, type OutboundRoute, outboundRouteOf } from "@binference/core";
import type { RuntimeNetwork } from "../control/runtime-settings.schema.js";

/**
 * The route the runtime's outbound requests take by its settings' network: through the owner's
 * proxy but for the hosts that go direct, held while the engine could not read the proxy, and
 * direct without one.
 */
export function networkRouteOf(network: RuntimeNetwork): OutboundRoute {
  const { proxy, noProxy } = network;
  if (proxy === undefined) {
    return outboundRouteOf({ noProxy });
  }
  return outboundRouteOf({
    proxy: proxy === "unread" ? "unread" : createSecret(proxy.url),
    noProxy,
  });
}
