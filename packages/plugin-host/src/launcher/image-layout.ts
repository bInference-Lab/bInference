import { join } from "node:path";
import { probeId } from "../probe/probe-id.js";
import type { PluginFolders } from "../process/plugin-node-arguments.js";

/**
 * Where the image keeps what its plugin launcher needs (decision 0344): the plugins' volume, with
 * each plugin's installed files under `packages/<id>`, its data under `data/<id>`, and the
 * launcher's socket in `run/`, which the image makes for the plugin user with the engine's group
 * inside the volume's root, which only the engine's user may change. The shell user runs the
 * agent's commands (decision 0412).
 */
export const imageLayout = {
  socket: "/var/lib/binference-plugins/run/launcher.sock",
  pluginsRoot: "/var/lib/binference-plugins",
  engineUser: { uid: 10_001, gid: 10_001 },
  pluginUser: { uid: 10_002, gid: 10_002 },
  shellUser: { uid: 10_003, gid: 10_003 },
} as const;

/** The variable that tells the engine's processes the launcher's socket, set by the image. */
export const launcherVariable = "BINFERENCE_PLUGIN_LAUNCHER";

/**
 * A plugin's folders in the image's plugins volume. The probe plugin's package is the one the
 * image ships, `probeFolder`; its data folder sits beside every other plugin's.
 */
export function imageFolders(id: string, probeFolder: string): PluginFolders {
  return {
    packageFolder: id === probeId ? probeFolder : join(imageLayout.pluginsRoot, "packages", id),
    dataFolder: join(imageLayout.pluginsRoot, "data", id),
  };
}
