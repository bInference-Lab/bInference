import { createMemoryQuotaSource } from "@binference/engine/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { describe, expect, it } from "vitest";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import { isPluginsFull, pluginsQuotaOf, withinPluginsQuota } from "./plugin-quota.js";

const manifest: CommunityManifest = {
  api: 1,
  id: "fear-index",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: [],
  tools: [],
};

function plugin(id: string, state: "on" | "off"): LockedPlugin {
  const enabled = state === "on";
  return {
    plugin: `plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a${id.length.toString(16)}`,
    id,
    packageName: id,
    version: "1.0.0",
    source: `npm:${id}@1.0.0`,
    integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    hash: "a".repeat(64),
    manifest: { ...manifest, id },
    accepted: "b".repeat(64),
    provenance: "none",
    enabled,
    ...(enabled ? {} : { disabledReason: "owner" as const }),
    installedAt: 1,
  };
}

const lock: PluginLock = { plugins: [plugin("on", "on"), plugin("off-one", "off")] };

describe("the plugins' quota", () => {
  it("reads the quota of plugins on, none without a source", async () => {
    const source = createMemoryQuotaSource({ enabledPlugins: 4 });
    const signal = AbortSignal.timeout(1_000);
    await expect(pluginsQuotaOf(source, signal)).resolves.toBe(4);
    await expect(pluginsQuotaOf(undefined, signal)).resolves.toBeUndefined();
  });

  it("is full once as many other plugins are on as the quota allows", () => {
    expect(isPluginsFull(lock, plugin("new", "on"), 1)).toBe(true);
    expect(isPluginsFull(lock, plugin("new", "on"), 2)).toBe(false);
    expect(isPluginsFull(lock, plugin("off-one", "off"), 1)).toBe(true);
    expect(isPluginsFull(lock, plugin("on", "on"), 1)).toBe(false);
    expect(isPluginsFull(lock, plugin("new", "on"), undefined)).toBe(false);
  });

  it("writes an install off where an enable since took the last room", () => {
    const fresh = plugin("new", "on");
    expect(withinPluginsQuota(lock, fresh, 1)).toStrictEqual({
      ...fresh,
      enabled: false,
      disabledReason: "owner",
    });
    expect(withinPluginsQuota(lock, fresh, 2)).toBe(fresh);
    expect(withinPluginsQuota(lock, fresh, undefined)).toBe(fresh);
  });
});
