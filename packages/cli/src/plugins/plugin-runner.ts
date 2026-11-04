import type { JsonValue, Logger, Result } from "@binference/core";
import {
  type CallFailure,
  type InstalledPluginSpec,
  type PluginFolders,
  type PluginHost,
  type PluginHostParts,
  createPluginHost,
  type TurnedOff,
} from "@binference/plugin-host";
import type { RuntimePlugin } from "@binference/runtime";
import { z } from "zod";
import { declarationsOf, digestOf } from "./plugin-declarations.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";

/** What runs the installed plugins: the plugin host's parts and where each plugin's folders are. */
export interface PluginRunnerParts {
  /**
   * Makes the host's parts once a plugin is installed; none where no built plugin program exists,
   * so no plugin runs.
   */
  hostParts(
    signal: AbortSignal,
  ): Promise<Omit<PluginHostParts, "tell" | "onTurnedOff"> | undefined>;
  readonly tell: PluginHostParts["tell"];
  /** Hears a plugin the host turned off, by its id, and why. */
  onTurnedOff(id: string, reason: "crashes" | "changed"): void;
  /** A plugin's folders by its id, made where the engine makes them. */
  foldersOf(id: string, signal: AbortSignal): Promise<PluginFolders>;
  /** Each plugin's settings now, `plugins.<id>` in `config.json5`. */
  configOf(id: string): JsonValue;
  /** Hands the agent runtime the tools of the plugins it may call. */
  offer(plugins: readonly RuntimePlugin[]): Promise<void>;
  readonly logger: Logger;
  /** Stops every plugin: the engine's shutdown. Each plugin runs under it, not under a call's. */
  readonly life: AbortSignal;
}

/** The installed plugins as they run. */
export interface PluginRunner {
  /**
   * Runs the sandbox check and the enabled plugins of the lock, once, when it holds any; answers
   * whether this call started them.
   */
  begin(lock: PluginLock): Promise<boolean>;
  /** Runs one plugin anew, as after an add or an enable, once the sandbox check passed. */
  run(entry: LockedPlugin): Promise<void>;
  stop(id: string): Promise<void>;
  call(
    call: { readonly plugin: string; readonly tool: string; readonly input: JsonValue },
    signal: AbortSignal,
  ): Promise<Result<JsonValue, CallFailure | "unknown_plugin">>;
  /** Hands the agent the tools of the lock's enabled plugins, while the sandbox holds. */
  offer(lock: PluginLock): Promise<void>;
}

// A plugin's settings meet the schema its manifest declares; a plugin without one takes none.
function configFits(entry: LockedPlugin, config: JsonValue): boolean {
  const schema = entry.manifest.config;
  if (schema === undefined) {
    return true;
  }
  try {
    return z.fromJSONSchema(schema).safeParse(config).success;
  } catch {
    return false;
  }
}

// What the host runs a plugin with, or nothing: a plugin whose declarations no longer hash to
// what the owner accepted is turned off as changed, and one whose settings miss its schema waits.
async function specOf(
  parts: PluginRunnerParts,
  entry: LockedPlugin,
  signal: AbortSignal,
): Promise<InstalledPluginSpec | undefined> {
  if (digestOf(declarationsOf(entry.manifest)) !== entry.accepted) {
    parts.onTurnedOff(entry.id, "changed");
    parts.tell({ kind: "refused", plugin: entry.id, refusal: "bad_manifest" });
    return undefined;
  }
  const config = parts.configOf(entry.id);
  if (!configFits(entry, config)) {
    parts.logger.warn("plugin.bad_config", { sourceId: entry.id });
    return undefined;
  }
  const folders = await parts.foldersOf(entry.id, signal);
  return { manifest: entry.manifest, folders, config, filesHash: entry.hash };
}

// The tools of the lock's enabled plugins, as the agent's settings carry them.
function offeredOf(lock: PluginLock): readonly RuntimePlugin[] {
  return lock.plugins
    .filter(({ enabled }) => enabled)
    .map(({ plugin, id, manifest }) => ({
      plugin,
      id,
      tools: manifest.tools.map(({ name, description, input }) => ({ name, description, input })),
    }));
}

/**
 * Runs the installed community plugins through one plugin host (decisions 0300 and 0348): the
 * sandbox check first, at the first `begin` with a plugin installed; then each enabled plugin
 * whose declarations still hash to the digest the owner accepted and whose settings meet its
 * schema, its files checked against their pin before each start. A plugin whose declarations
 * changed is turned off as `changed`. The agent is offered the tools of the enabled plugins only
 * while the sandbox holds.
 */
export function createPluginRunner(parts: PluginRunnerParts): PluginRunner {
  const state: { host: PluginHost | undefined; held: boolean } = { host: undefined, held: false };
  const turnedOff = (id: string, reason: TurnedOff): void =>
    parts.onTurnedOff(id, reason === "crashes" ? "crashes" : "changed");
  return {
    async begin(lock) {
      const signal = parts.life;
      if (state.host !== undefined || lock.plugins.length === 0) {
        return false;
      }
      const hostParts = await parts.hostParts(signal);
      if (hostParts === undefined || state.host !== undefined) {
        return false;
      }
      state.host = createPluginHost({ ...hostParts, tell: parts.tell, onTurnedOff: turnedOff });
      const enabled = lock.plugins.filter(({ enabled: on }) => on);
      const specs = await Promise.all(enabled.map(async (entry) => specOf(parts, entry, signal)));
      const runnable = specs.flatMap((spec) => (spec === undefined ? [] : [spec]));
      state.held = (await state.host.start(runnable, signal)).ok;
      return true;
    },
    async run(entry) {
      const spec = state.held ? await specOf(parts, entry, parts.life) : undefined;
      if (spec !== undefined) {
        await state.host?.run(spec);
      }
    },
    stop: async (id) => state.host?.stop(id),
    call: async (call, signal) =>
      state.host === undefined
        ? { ok: false, error: "unknown_plugin" }
        : state.host.call(call, signal),
    offer: async (lock) => parts.offer(state.held ? offeredOf(lock) : []),
  };
}
