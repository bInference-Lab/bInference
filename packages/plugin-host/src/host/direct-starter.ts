import { startNodeProgram } from "@binference/platform";
import type { PluginStarter } from "../ports.js";
import { pluginNodeArguments } from "../process/plugin-node-arguments.js";
import { type ResidentWatch, watchResident } from "./watch-resident.js";

/**
 * The starter that runs each plugin under the engine's own OS user: `process.execPath` with
 * `pluginNodeArguments` and the plugin program, in the plugin's package folder, which it may only
 * read, with no variable of `parentEnv` but what the OS needs to run Node. It ends a plugin whose
 * resident memory passes the limit of `memory`. Its plugins can signal every process of that
 * user, the engine among them, which `binference check` warns of.
 */
export function createDirectStarter(options: {
  /** The plugin program, `plugin-process.mjs`, by its real path. */
  readonly program: string;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly memory: ResidentWatch;
}): PluginStarter {
  return {
    ownUser: false,
    start: async (launch, signal) => {
      const program = startNodeProgram({
        args: pluginNodeArguments(options.program, launch.folders),
        parentEnv: options.parentEnv,
        cwd: launch.folders.packageFolder,
        signal,
      });
      watchResident(program, options.memory);
      return program;
    },
  };
}
