import { homedir } from "node:os";
import { outboundRouteOf } from "@binference/core";
import { platformOf } from "../compose/engine-locations.js";
import { openProxyCell } from "../compose/proxy-cell.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { CliHost } from "../program/cli-host.js";
import { loadHostConfig } from "../program/load-host-config.js";

// What reads the proxy logs nothing here: a command's output says what it could not reach.
const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

/**
 * Puts the route config names in force on the command's outbound adapter, as the engine does
 * (decision 0347): through the owner's proxy, read from its secret source, but for the no-proxy
 * list and addresses off the internet. A config that does not load holds every request, so a
 * command never reaches out around a proxy it could not read.
 */
export async function useConfigRoute(host: CliHost, signal: AbortSignal): Promise<void> {
  const loaded = await loadHostConfig(host, signal);
  if (!loaded.ok) {
    host.outbound.use(outboundRouteOf({ proxy: "unread", noProxy: [] }));
    return;
  }
  const secrets = createSecretReader({
    env: host.env,
    keychain: platformOf(host).keychain,
    homeDir: host.homeDir ?? homedir(),
    clock: host.clock,
  });
  const network = () => loaded.config.network;
  await openProxyCell(
    { network, secrets, outbound: host.outbound, http: host.http, logger: quiet },
    signal,
  );
}
