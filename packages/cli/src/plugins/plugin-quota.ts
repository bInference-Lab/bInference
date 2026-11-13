import type { QuotaSource } from "@binference/engine/quotas";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";

/** The install's quota of plugins turned on (decision 0431), or none when no source holds one. */
export async function pluginsQuotaOf(
  quotas: QuotaSource | undefined,
  signal: AbortSignal,
): Promise<number | undefined> {
  return quotas === undefined ? undefined : (await quotas.read({ signal })).enabledPlugins;
}

/**
 * Whether turning `plugin` on would pass the quota: the lock holds that many other plugins on.
 * With no quota nothing is counted, and a plugin on already never passes it.
 */
export function isPluginsFull(
  lock: PluginLock,
  plugin: Pick<LockedPlugin, "id">,
  quota: number | undefined,
): boolean {
  if (quota === undefined) {
    return false;
  }
  const on = lock.plugins.filter(({ enabled }) => enabled);
  return !on.some(({ id }) => id === plugin.id) && on.length >= quota;
}

/**
 * The entry an install writes into the lock it changes: off, as the owner turns one off, when
 * turning it on would pass the quota there, as an enable that landed since the install counted can
 * leave it; else as it came.
 */
export function withinPluginsQuota(
  lock: PluginLock,
  entry: LockedPlugin,
  quota: number | undefined,
): LockedPlugin {
  return entry.enabled && isPluginsFull(lock, entry, quota)
    ? { ...entry, enabled: false, disabledReason: "owner" }
    : entry;
}
