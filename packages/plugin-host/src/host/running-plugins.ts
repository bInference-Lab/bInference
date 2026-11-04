import { err, type JsonValue, type Result } from "@binference/core";
import { checkPluginFiles } from "../pins/plugin-files-digest.js";
import { createHostRefusals, type TellOwner } from "./host-notice.js";
import {
  type CallFailure,
  openPlugin,
  type OpenPluginParts,
  type PluginSpec,
} from "./open-plugin.js";
import { type SupervisedPlugin, supervisePlugin, type TurnedOff } from "./supervise-plugin.js";

/** An installed community plugin as the host runs it: its spec and the pin of its files. */
export interface InstalledPluginSpec extends PluginSpec {
  /** The SHA-256 its installed files must hash to before each start (decision 0348). */
  readonly filesHash: string;
}

/** What the running plugins are kept with. */
export interface RunningPluginsParts extends Omit<OpenPluginParts, "onRefused"> {
  readonly tell: TellOwner;
  /** Hears a plugin the host turned off, to record why as its `disabled_reason`. */
  onTurnedOff(plugin: string, reason: TurnedOff): void;
}

/** The plugins the host runs now, by id. */
export interface RunningPlugins {
  /** Starts a plugin, stopping one of its id first; settles once its first start is done. */
  run(spec: InstalledPluginSpec, signal: AbortSignal): Promise<void>;
  /** Stops a plugin and settles once its process ended; one it does not run is none. */
  stop(plugin: string): Promise<void>;
  /** Calls a running plugin's tool; `unknown_plugin` for a plugin the host does not run. */
  call(
    call: { readonly plugin: string; readonly tool: string; readonly input: JsonValue },
    signal: AbortSignal,
  ): Promise<Result<JsonValue, CallFailure | "unknown_plugin">>;
}

/** One plugin the host runs: its supervisor and what stops it alone. */
interface Running {
  readonly supervised: SupervisedPlugin;
  readonly stop: AbortController;
}

// Starts one plugin under its supervisor, its files checked against their pin before each start.
function superviseOne(
  parts: RunningPluginsParts,
  spec: InstalledPluginSpec,
  heard: {
    readonly refused: (plugin: string, host: string) => void;
    readonly turnedOff: (plugin: string, reason: TurnedOff) => void;
    readonly signal: AbortSignal;
  },
): Running {
  const plugin = spec.manifest.id;
  const stop = new AbortController();
  const openParts = { ...parts, onRefused: (host: string) => heard.refused(plugin, host) };
  const open = async (openSignal: AbortSignal) => {
    const { packageFolder } = spec.folders;
    const pinned = await checkPluginFiles(packageFolder, spec.filesHash, openSignal);
    return pinned.ok ? openPlugin(spec, openParts, openSignal) : err(pinned.error);
  };
  const supervised = supervisePlugin(
    {
      plugin,
      open,
      clock: parts.clock,
      logger: parts.logger,
      onEnded: (end) => {
        if (end === "stalled") {
          parts.tell({ kind: "stalled", plugin });
        }
      },
      onTurnedOff: (reason) => heard.turnedOff(plugin, reason),
    },
    AbortSignal.any([heard.signal, stop.signal]),
  );
  return { supervised, stop };
}

/**
 * The plugins the host keeps running, each under its own supervisor: before each start its
 * installed folder is walked for links and its files checked against their pin (decisions 0343
 * and 0348). The owner hears of a plugin turned off after its crashes (`stopped`), of one whose
 * files or manifest are not the ones added (`refused`), of one that stalled, and of each
 * undeclared host once per plugin and host a day.
 */
export function createRunningPlugins(parts: RunningPluginsParts): RunningPlugins {
  const running = new Map<string, Running>();
  const refused = createHostRefusals(parts);
  const turnedOff = (plugin: string, reason: TurnedOff): void => {
    running.delete(plugin);
    parts.tell(
      reason === "crashes"
        ? { kind: "stopped", plugin }
        : { kind: "refused", plugin, refusal: reason },
    );
    parts.onTurnedOff(plugin, reason);
  };
  const stop = async (plugin: string): Promise<void> => {
    const one = running.get(plugin);
    running.delete(plugin);
    one?.stop.abort();
    await one?.supervised.done;
  };
  return {
    run: async (spec, signal) => {
      await stop(spec.manifest.id);
      const one = superviseOne(parts, spec, { refused, turnedOff, signal });
      running.set(spec.manifest.id, one);
      await one.supervised.firstStart;
    },
    stop,
    call: async ({ plugin, tool, input }, signal) => {
      const one = running.get(plugin);
      return one === undefined ? err("unknown_plugin") : one.supervised.call(tool, input, signal);
    },
  };
}
