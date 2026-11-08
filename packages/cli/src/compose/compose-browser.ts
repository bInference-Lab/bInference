import { lookup } from "node:dns";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  browserIdleMs,
  browserRouteOf,
  createAddressGuard,
  createBrowserDriver,
  withIdleStop,
} from "@binference/browser";
import type { EngineBrowser } from "@binference/engine/browser";
import { realFilePath, walledPaths } from "@binference/platform";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { Opened, Opening } from "./open-engine-parts.js";

// How long finding a path's real path may take before the request it serves is refused.
const realPathMs = 2_000;

// The engine's own ports on this machine, which the browser never reaches.
function enginePortsOf(config: BinferenceConfig): readonly number[] {
  return [config.engine.port, config.engine.webhookPort];
}

function publicOriginOf(config: BinferenceConfig): string | undefined {
  const url = config.remote.publicUrl;
  return url === undefined ? undefined : new URL(url).origin;
}

/**
 * The agent's browser on this machine (decision 0401): the program `browser.executablePath`
 * names, else the Chrome-family browser the platform finds, with its profile in
 * `browser/default` of the state folder, headless where the machine has no desktop unless
 * `browser.headless` says, through the owner's proxy, every request checked against the engine's
 * ports, the `remote.publicUrl` origin, the state folder and, unless the owner allows them,
 * private networks. It stops after 10 minutes without a call, and with the engine.
 */
export function browserOf(opening: Opening, opened: Opened): EngineBrowser {
  const { host, platform } = opening;
  const config = (): BinferenceConfig => opened.settings.current();
  const guard = createAddressGuard({
    allowPrivateNetwork: () => config().browser.allowPrivateNetwork,
    enginePorts: () => enginePortsOf(config()),
    publicOrigin: () => publicOriginOf(config()),
    walled: walledPaths(platform.stateFolder),
    lookup,
    realPath: async (path) =>
      realFilePath(path, AbortSignal.timeout(realPathMs)).catch(() => undefined),
  });
  const driver = createBrowserDriver({
    launch: () => {
      const { headless, executablePath } = config().browser;
      const home = host.homeDir ?? homedir();
      return {
        headless: headless ?? !platform.hasDesktopSession,
        ...(executablePath === undefined
          ? {}
          : { executablePath: executablePath.replace(/^~(?=[\\/]|$)/u, home) }),
      };
    },
    findBrowser: () => platform.findBrowser(),
    userDataFolder: join(platform.stateFolder.root, "browser", "default"),
    route: () => browserRouteOf(opened.proxy.current()),
    guard,
    logger: opened.log.logger.child("browser"),
  });
  const browser = withIdleStop(driver, { clock: host.clock, idleMs: browserIdleMs });
  opening.closers.add("browser", async () => browser.stop());
  return {
    driver: browser,
    settings: () => {
      const { enabled, evaluate } = config().browser;
      return { enabled, evaluate };
    },
  };
}
