import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import type { ConfigOutcome } from "../config/validate-config.js";
import type { CliHost } from "./cli-host.js";
import { systemDefaults } from "./system-defaults.js";

/**
 * Loads the install's `config.json5` as a command that takes no `--set` reads it: the file in the
 * host's state folder, the host's environment and this machine's defaults.
 */
export async function loadHostConfig(host: CliHost, signal: AbortSignal): Promise<ConfigOutcome> {
  const platform = platformOf(host);
  return loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal,
  });
}
