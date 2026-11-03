import { err, type JsonValue, ok, type Result } from "@binference/core";
import { checkSandbox, type SandboxCheckParts, type SandboxPass } from "../probe/check-sandbox.js";
import { createHostRefusals, type SandboxFailure, type TellOwner } from "./host-notice.js";
import { type CallFailure, openPlugin, type PluginSpec } from "./open-plugin.js";
import { type SupervisedPlugin, supervisePlugin } from "./supervise-plugin.js";

/** What the plugin host runs with. */
export interface PluginHostParts extends SandboxCheckParts {
  readonly tell: TellOwner;
  /** Hears a plugin turned off for its crashes, to record `disabled_reason: crashes`. */
  onTurnedOff(plugin: string): void;
}

/** The engine part that runs community plugins (ARCHITECTURE.md section 14). */
export interface PluginHost {
  /**
   * Runs the sandbox check, then starts each plugin under its supervisor, and settles once each
   * first start is ready or failed. A check that fails
   * starts none, tells the owner `notice.pluginSandboxOff` and answers why. The signal stops
   * every plugin.
   */
  start(
    specs: readonly PluginSpec[],
    signal: AbortSignal,
  ): Promise<Result<SandboxPass, SandboxFailure>>;
  /** Calls a running plugin's tool; `unknown_plugin` for a plugin the host does not run. */
  call(
    call: { readonly plugin: string; readonly tool: string; readonly input: JsonValue },
    signal: AbortSignal,
  ): Promise<Result<JsonValue, CallFailure | "unknown_plugin">>;
}

/**
 * Makes the plugin host (decision 0300): each plugin in a process of its own through the starter,
 * kept running by its supervisor, its fetches to undeclared hosts told to the owner once per
 * plugin and host a day (`notice.pluginHostRefused`), and a plugin turned off after 5 crashes in
 * 10 minutes told as `notice.pluginStopped`.
 */
export function createPluginHost(parts: PluginHostParts): PluginHost {
  const running = new Map<string, SupervisedPlugin>();
  const refused = createHostRefusals(parts);
  const superviseOne = (spec: PluginSpec, signal: AbortSignal): SupervisedPlugin => {
    const plugin = spec.manifest.id;
    const openParts = { ...parts, onRefused: (host: string) => refused(plugin, host) };
    return supervisePlugin(
      {
        plugin,
        open: async (runSignal) => openPlugin(spec, openParts, runSignal),
        clock: parts.clock,
        logger: parts.logger,
        onEnded: (end) => {
          if (end === "stalled") {
            parts.tell({ kind: "stalled", plugin });
          }
        },
        onTurnedOff: () => {
          running.delete(plugin);
          parts.tell({ kind: "stopped", plugin });
          parts.onTurnedOff(plugin);
        },
      },
      signal,
    );
  };
  return {
    start: async (specs, signal) => {
      const checked = await checkSandbox(parts, signal);
      if (!checked.ok) {
        parts.tell({ kind: "sandboxOff", reason: checked.error });
        return checked;
      }
      const firstStarts = specs.map((spec) => {
        const plugin = superviseOne(spec, signal);
        running.set(spec.manifest.id, plugin);
        return plugin.firstStart;
      });
      await Promise.all(firstStarts);
      return ok(checked.value);
    },
    call: async ({ plugin, tool, input }, signal) => {
      const supervised = running.get(plugin);
      return supervised === undefined
        ? err("unknown_plugin")
        : supervised.call(tool, input, signal);
    },
  };
}
