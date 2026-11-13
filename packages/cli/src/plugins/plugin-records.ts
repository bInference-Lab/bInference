import { BinferenceError } from "@binference/core";
import type { FilePermissions } from "@binference/platform";
import { protocolIdSchema, type ResultOf } from "@binference/protocol";
import { pluginToolName } from "@binference/runtime";
import { declarationsOf } from "./plugin-declarations.js";
import {
  type LockedPlugin,
  type PluginLock,
  readPluginLock,
  writePluginLock,
} from "./plugin-lock.js";

type PluginView = ResultOf<"plugin/list">["items"][number];

/**
 * The plugin lock as the engine keeps it: every change reads the lock, changes it and writes it
 * back, one change at a time, so two changes never write over each other. A lock that does not
 * read fails every read and change with `plugin.lock_unreadable`, and is never written over.
 */
export interface PluginRecords {
  /** The lock once the changes asked for before it are written. */
  read(signal: AbortSignal): Promise<PluginLock>;
  /** Writes what `change` makes of the lock and answers it; a change that throws writes nothing. */
  change(
    change: (lock: PluginLock) => PluginLock | Promise<PluginLock>,
    signal: AbortSignal,
  ): Promise<PluginLock>;
}

/** Keeps the plugin lock at `file`, owner-only. */
export function createPluginRecords(parts: {
  readonly file: string;
  readonly permissions: FilePermissions;
}): PluginRecords {
  let last: Promise<void> = Promise.resolve();
  const readNow = async (signal: AbortSignal): Promise<PluginLock> => {
    const read = await readPluginLock(parts.file, signal);
    if (!read.ok) {
      throw new BinferenceError({
        code: "plugin.lock_unreadable",
        message: "The plugin lock does not read; no plugin changes or runs.",
      });
    }
    return read.value;
  };
  return {
    async read(signal) {
      await last;
      return readNow(signal);
    },
    async change(change, signal) {
      const run = last.then(async () => {
        const next = await change(await readNow(signal));
        await writePluginLock(parts.file, next, { permissions: parts.permissions, signal });
        return next;
      });
      last = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

/** The lock with these plugins in place of its own; every other part of it kept. */
export function withPlugins(lock: PluginLock, plugins: readonly LockedPlugin[]): PluginLock {
  return { ...lock, plugins };
}

/** One plugin of the lock replaced by `entry`, or added when the lock has none of its id. */
export function withPlugin(lock: PluginLock, entry: LockedPlugin): PluginLock {
  return withPlugins(lock, [...lock.plugins.filter(({ id }) => id !== entry.id), entry]);
}

/** Whether a plugin the lock has on runs, under a rule that needs listings: or waits, held. */
export type ListedStanding = "listed" | "held";

// Where the plugin stands with its listing (decisions 0433 and 0435), under a rule that needs one.
function listingViewOf(entry: LockedPlugin, standing: ListedStanding): PluginView["listing"] {
  const { listing } = entry;
  if (listing === undefined) {
    return { state: "unlisted" };
  }
  const ref = {
    listing: protocolIdSchema("pluginListing").parse(listing.listing),
    version: listing.version,
  };
  return { ...ref, state: entry.disabledReason === "revoked" ? "revoked" : standing };
}

/**
 * An installed plugin as `plugin/list` shows it: its permissions as `kind:`, `host:`, `tool:` and
 * `config:` each followed by its name, and its tools by the names the agent calls them. Under a
 * rule that needs listings, `standing` says whether one on is held, and the view names its
 * listing; a revoked plugin is off with no `disabledReason`, which names three reasons only.
 */
export function pluginViewOf(entry: LockedPlugin, standing?: ListedStanding): PluginView {
  const { disabledReason } = entry;
  const listing = standing === undefined ? undefined : listingViewOf(entry, standing);
  const declared = declarationsOf(entry.manifest);
  const permissions = [
    ...declared.kinds.map((kind) => `kind:${kind}`),
    ...declared.hosts.map((host) => `host:${host}`),
    ...declared.tools.map((tool) => `tool:${tool}`),
    ...declared.configKeys.map((key) => `config:${key}`),
  ];
  return {
    plugin: protocolIdSchema("installedPlugin").parse(entry.plugin),
    name: entry.id,
    version: entry.version,
    tier: "community",
    source: entry.source,
    hash: entry.hash,
    permissions,
    state: entry.enabled ? "enabled" : "disabled",
    installedAt: entry.installedAt,
    provenance: entry.provenance,
    ...(entry.publisher === undefined ? {} : { publisher: entry.publisher }),
    ...(disabledReason === undefined || disabledReason === "revoked" ? {} : { disabledReason }),
    tools: entry.manifest.tools.map(({ name }) => pluginToolName(entry.id, name)),
    ...(listing === undefined ? {} : { listing }),
  };
}
