import { err, ok, type Result } from "@binference/core";
import { checkSandbox, type SandboxCheckParts, type SandboxPass } from "../probe/check-sandbox.js";
import { probeId } from "../probe/probe-id.js";
import type { SandboxFailure } from "./host-notice.js";
import {
  createRunningPlugins,
  type InstalledPluginSpec,
  type RunningPlugins,
  type RunningPluginsParts,
} from "./running-plugins.js";

/** What the plugin host runs with. */
export interface PluginHostParts extends SandboxCheckParts, Omit<RunningPluginsParts, "starter"> {}

/** Why the host runs no plugin it was asked to: no sandbox check passed, or the probe's own id. */
export type RunRefusal = "sandbox_unchecked" | "probe_id";

/**
 * The engine part that runs community plugins (ARCHITECTURE.md section 14): it stops and calls
 * them as the running plugins do.
 */
export interface PluginHost extends Pick<RunningPlugins, "stop" | "call"> {
  /**
   * Runs the sandbox check, then starts each plugin under its supervisor, and settles once each
   * first start is ready or failed. A check that fails starts none, tells the owner
   * `notice.pluginSandboxOff` and answers why. The signal stops every plugin.
   */
  start(
    specs: readonly InstalledPluginSpec[],
    signal: AbortSignal,
  ): Promise<Result<SandboxPass, SandboxFailure>>;
  /**
   * Starts one more plugin, as one the owner adds or turns on, once `start` passed its check, and
   * settles once its first start is ready or failed; a plugin of that id that runs stops first.
   */
  run(spec: InstalledPluginSpec): Promise<Result<void, RunRefusal>>;
}

/**
 * Makes the plugin host (decision 0300): a sandbox check first, then each plugin in a process of
 * its own through the starter, kept running by its supervisor, its installed files checked
 * against their pin and walked for links before each start (decision 0348). It never runs a
 * plugin with the probe plugin's id, and runs none before a check passed.
 */
export function createPluginHost(parts: PluginHostParts): PluginHost {
  const plugins = createRunningPlugins(parts);
  const held: { signal: AbortSignal | undefined } = { signal: undefined };
  return {
    start: async (specs, signal) => {
      const checked = await checkSandbox(parts, signal);
      if (!checked.ok) {
        parts.tell({ kind: "sandboxOff", reason: checked.error });
        return checked;
      }
      held.signal = signal;
      const runnable = specs.filter((spec) => spec.manifest.id !== probeId);
      await Promise.all(runnable.map(async (spec) => plugins.run(spec, signal)));
      return ok(checked.value);
    },
    run: async (spec) => {
      if (held.signal === undefined) {
        return err("sandbox_unchecked");
      }
      if (spec.manifest.id === probeId) {
        return err("probe_id");
      }
      await plugins.run(spec, held.signal);
      return ok(undefined);
    },
    stop: async (plugin) => plugins.stop(plugin),
    call: async (call, signal) => plugins.call(call, signal),
  };
}
