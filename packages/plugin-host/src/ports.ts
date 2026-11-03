import type { NodeProgram } from "@binference/platform";
import type { PluginLaunch } from "./process/plugin-node-arguments.js";

/** One community plugin's process, held through its standard input and output. */
export type PluginProgram = Pick<NodeProgram, "write" | "end" | "output" | "exited" | "kill">;

/**
 * Starts a community plugin's process with `pluginNodeArguments`, in its data folder, with an
 * environment of only what the OS needs to run Node (decision 0300). Adapters: the direct starter
 * (`createDirectStarter`), which starts it under the engine's own OS user, and the image's plugin
 * launcher (decision 0344), which starts it under the plugin user. A start that fails rejects;
 * the signal ends the program at once.
 */
export interface PluginStarter {
  /** Whether its plugins run under an OS user apart from the engine's, which cannot signal it. */
  readonly ownUser: boolean;
  start(launch: PluginLaunch, signal: AbortSignal): Promise<PluginProgram>;
}
