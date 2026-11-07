import { join } from "node:path";
import {
  BinferenceError,
  createIdSource,
  type HttpDownload,
  type JsonValue,
  type Logger,
} from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { RunningTurns, ViewImageSource } from "@binference/engine/chat";
import { createPluginNotices } from "@binference/engine/notices";
import type { EngineShell } from "@binference/engine/shell";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { ensurePrivateFolder, realFilePath, removePath } from "@binference/platform";
import {
  imageFolders,
  imageLayout,
  launcherVariable,
  type PluginFolders,
  removeLauncherData,
} from "@binference/plugin-host";
import type { RuntimePlugin } from "@binference/runtime";
import { createNpmRegistry, npmRegistry } from "../plugins/npm-registry.js";
import type { PluginLock } from "../plugins/plugin-lock.js";
import { createPluginRecords, type PluginRecords } from "../plugins/plugin-records.js";
import { createPluginRunner, type PluginRunner } from "../plugins/plugin-runner.js";
import type { PluginShelf } from "../plugins/put-plugin.js";
import { sigstoreVerifier } from "../plugins/sigstore-verifier.js";
import { type ComposedRuntime, composeRuntime } from "./compose-runtime.js";
import { agentFilesOf, shellOf } from "./compose-shell.js";
import { viewImagesOf } from "./compose-view-images.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { createPluginOperations } from "./plugin-operations.js";
import {
  builtPluginPrograms,
  decoyOf,
  type PluginPrograms,
  probeSettingOf,
} from "./plugin-sandbox.js";
import { createPluginSwitch } from "./plugin-switch.js";

/** The community plugins as the engine holds them. */
interface ComposedPlugins {
  /** The handlers of `plugin/list`, `add`, `enable`, `disable`, `remove` and `call`. */
  readonly handlers: EngineHandlerTable;
  /**
   * Starts the sandbox check and the installed plugins, when any is installed, beside the rest of
   * the start, since the check takes seconds, and hands the agent the tools of those on once they
   * run; a failure is logged. The shutdown stops them.
   */
  begin(): void;
}

/** The agent runtime, the community plugins beside it, and what the engine reads of them. */
export interface RuntimeWithPlugins {
  readonly runtime: ComposedRuntime;
  readonly plugins: ComposedPlugins;
  /**
   * The runtime's running turns, and whether the agent is offered a community plugin's tools now:
   * its turns then start marked as outside content, and auto mode asks for every proposal
   * (decision 0350).
   */
  readonly agentSide: {
    readonly turns: ComposedRuntime["turns"];
    readonly communityPluginsOn: () => boolean;
    /** The agent's shell on this machine (decision 0378). */
    readonly shell: EngineShell;
    /** The images the agent views on this machine (decision 0385). */
    readonly viewImages: ViewImageSource;
  };
}

/** Where plugins' files live on this machine, and who makes and removes their data folders. */
interface PluginPlaces {
  readonly shelf: PluginShelf;
  foldersOf(id: string, programs: PluginPrograms, signal: AbortSignal): Promise<PluginFolders>;
  makeData(id: string, signal: AbortSignal): Promise<void>;
  removeData(id: string, signal: AbortSignal): Promise<void>;
}

// In the image the plugins' volume holds each package for the plugin user to read, and the
// launcher makes, owns and removes each data folder (decisions 0344 and 0351); elsewhere both sit
// in `plugins/`.
function placesOf(opening: Opening): PluginPlaces {
  const { platform, host } = opening;
  const socket = host.env[launcherVariable];
  if (socket !== undefined && socket !== "") {
    const root = imageLayout.pluginsRoot;
    return {
      shelf: { packages: join(root, "packages"), work: join(root, "work") },
      foldersOf: async (id, programs) => imageFolders(id, programs.probeFolder),
      makeData: async () => Promise.resolve(),
      // Only the plugin user may change a data folder, so the launcher removes it (decision 0351).
      removeData: async (id, signal) =>
        removeLauncherData({ socket }, id, AbortSignal.any([signal, AbortSignal.timeout(30_000)])),
    };
  }
  const root = join(platform.stateFolder.root, "plugins");
  const data = (id: string): string => join(root, "data", id);
  const files = { permissions: platform.permissions };
  return {
    shelf: { packages: join(root, "packages"), work: join(root, "work") },
    foldersOf: async (id, _programs, signal) => ({
      packageFolder: await realFilePath(join(root, "packages", id), signal),
      dataFolder: await realFilePath(data(id), signal),
    }),
    makeData: async (id, signal) => ensurePrivateFolder(data(id), { ...files, signal }),
    removeData: async (id, signal) => removePath(data(id), signal),
  };
}

// A download that reaches nothing, for a host that downloads no file.
const noDownload: HttpDownload = {
  download: async () =>
    Promise.reject(
      new BinferenceError({ code: "http.unreachable", message: "This host downloads no file." }),
    ),
};

/** What the plugins are composed with besides the opened engine. */
interface PluginWiring {
  readonly turns: RunningTurns;
  /** The engine's one publish, once it exists. */
  readonly publish: () => PublishPush;
  /** Hands the agent runtime the tools of the plugins on. */
  offer(plugins: readonly RuntimePlugin[]): Promise<void>;
}

// Records a plugin the host turned off, and takes its tools from the agent; a lock it cannot
// write is logged, and the plugin stays off until the next start.
function turnOff(
  parts: {
    readonly records: PluginRecords;
    readonly logger: Logger;
    readonly offer: (lock: PluginLock) => Promise<void>;
  },
  off: { readonly id: string; readonly reason: "crashes" | "changed" },
): void {
  const { id, reason } = off;
  void parts.records
    .change(
      (lock) => ({
        plugins: lock.plugins.map((entry) =>
          entry.id === id ? { ...entry, enabled: false, disabledReason: reason } : entry,
        ),
      }),
      AbortSignal.timeout(30_000),
    )
    .then(async (lock) => parts.offer(lock))
    .catch(() => parts.logger.warn("plugin.lock_unwritten", { sourceId: id }));
}

function runnerOf(
  opening: Opening,
  opened: Opened,
  parts: {
    readonly places: PluginPlaces;
    readonly records: PluginRecords;
    readonly wiring: PluginWiring;
    readonly logger: Logger;
    readonly life: AbortSignal;
  },
): PluginRunner {
  const { host, platform } = opening;
  const { places, records, wiring, logger, life } = parts;
  const programs: { built: PluginPrograms | undefined } = { built: undefined };
  const tell = createPluginNotices({
    clock: host.clock,
    publish: (push) => wiring.publish()(push),
  });
  const runner: PluginRunner = createPluginRunner({
    hostParts: async (signal) => {
      programs.built = host.pluginPrograms ?? (await builtPluginPrograms(signal));
      if (programs.built === undefined) {
        return undefined;
      }
      const setting = await probeSettingOf({ host, platform, signal }, programs.built);
      const engineArgs = host.entry.nodeOptions;
      return {
        ...setting,
        http: host.http,
        clock: host.clock,
        logger,
        engineArgs,
        startDecoy: decoyOf(host),
      };
    },
    tell,
    onTurnedOff: (id, reason) => {
      turnOff({ records, logger, offer: async (lock) => runner.offer(lock) }, { id, reason });
    },
    foldersOf: async (id, signal) => {
      const built = programs.built ?? { program: "", probeFolder: "" };
      return places.foldersOf(id, built, signal);
    },
    configOf: (id): JsonValue => opened.settings.current().plugins[id] ?? {},
    offer: async (plugins) => wiring.offer(plugins),
    logger,
    life,
  });
  return runner;
}

// Runs the sandbox check and the installed plugins, and hands the agent the tools of those on;
// with none installed it does nothing, and the runtime's settings keep holding no plugin. A start
// the engine's stop cut short is no failure; any other is logged, an unreadable lock among them,
// which runs no plugin and which every plugin operation names (`plugin.lock_unreadable`).
async function startPlugins(
  parts: {
    readonly records: PluginRecords;
    readonly runner: PluginRunner;
    readonly logger: Logger;
  },
  signal: AbortSignal,
): Promise<void> {
  try {
    const lock = await parts.records.read(signal);
    if (lock.plugins.length === 0) {
      return;
    }
    await parts.runner.begin(lock);
    await parts.runner.offer(lock);
  } catch (error) {
    if (!signal.aborted) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      parts.logger.warn("plugin.begin_failed", { errorCode });
    }
  }
}

/**
 * The community plugins of a self-hosted engine (decisions 0300, 0348 and 0349): the plugin lock
 * in the state folder's `plugins/lock.json`, packages fetched from npm's registry (a test host
 * names its own), checked against Sigstore's trust root, put on this machine's shelf, and run
 * through the plugin host under this machine's starter with the engine's own Node options, so
 * the host refuses to run any while the engine's debug signal is on.
 */
function composePlugins(opening: Opening, opened: Opened, wiring: PluginWiring): ComposedPlugins {
  const { host, platform, closers } = opening;
  const logger = opened.log.logger.child("plugins");
  const places = placesOf(opening);
  const records = createPluginRecords({
    file: join(platform.stateFolder.root, "plugins", "lock.json"),
    permissions: platform.permissions,
  });
  const stop = new AbortController();
  closers.add("plugins", async () => stop.abort());
  const runner = runnerOf(opening, opened, { places, records, wiring, logger, life: stop.signal });
  const ids = createIdSource({ clock: host.clock, random: host.random });
  const handlers = createPluginOperations({
    registry: createNpmRegistry({
      download: host.download ?? noDownload,
      base: host.npmRegistry ?? npmRegistry,
    }),
    verify: sigstoreVerifier(),
    records,
    shelf: places.shelf,
    runner,
    makeData: async (id, signal) => places.makeData(id, signal),
    removeData: async (id, signal) => places.removeData(id, signal),
    newPlugin: () => ids.next("plg"),
    turns: wiring.turns,
    publish: (push) => wiring.publish()(push),
    closers,
    clock: host.clock,
    random: host.random,
    logger,
  });
  return {
    handlers,
    begin: () => {
      void startPlugins({ records, runner, logger }, stop.signal);
    },
  };
}

/**
 * The agent runtime and the community plugins beside it: the plugins' answers mark the runtime's
 * turns, their notices and jobs go through the engine's publish once it exists, their tools reach
 * the runtime's settings, and they start as the runtime begins. While their tools are offered,
 * `communityPluginsOn` says so (decision 0350).
 */
export function composeRuntimeWithPlugins(
  opening: Opening,
  opened: Opened,
  jobs: { readonly publish: PublishPush },
): RuntimeWithPlugins {
  const runtime = composeRuntime(opening, opened);
  const offered = createPluginSwitch(async (plugins) => runtime.offerPlugins(plugins));
  const composed = composePlugins(opening, opened, {
    turns: runtime.turns,
    publish: () => jobs.publish,
    offer: async (plugins) => offered.offer(plugins),
  });
  const begin = (server: Parameters<ComposedRuntime["begin"]>[0]): void => {
    runtime.begin(server);
    composed.begin();
  };
  const communityPluginsOn = (): boolean => offered.isOn();
  const viewImages = viewImagesOf({
    ...(opening.host.download === undefined ? {} : { download: opening.host.download }),
    files: agentFilesOf(opening, opened),
  });
  const agentSide = {
    turns: runtime.turns,
    communityPluginsOn,
    shell: shellOf(opening, opened),
    viewImages,
  };
  return { runtime: { ...runtime, begin }, plugins: composed, agentSide };
}
