import { describe, expect, it } from "vitest";
import { type ApplyTime, applyTimeEntries, applyTimeOf } from "./apply-times.js";
import { configTree } from "./config-json-schema.js";
import type { ConfigNode } from "./config-tree.js";
import { currentConfigVersion } from "./migrations/config-migrations.js";
import { configSchema } from "./schema/config.schema.js";

const started = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});

// Every key of the config's shape, a map's free key written `*`.
function keysOf(node: ConfigNode, path: readonly string[]): readonly string[] {
  if (node.kind === "group") {
    return [...node.keys].flatMap(([key, child]) => keysOf(child, [...path, key]));
  }
  return node.kind === "map" ? keysOf(node.value, [...path, "*"]) : [path.join(".")];
}

const covers = (entry: string, key: string): boolean => {
  const parts = entry.split(".");
  const segments = key.split(".");
  return parts.every((part, at) => part === "*" || part === segments[at]);
};

describe("when a config change applies", () => {
  it("has an entry for every key of the config, so none waits for a restart by omission", () => {
    const entries = applyTimeEntries();
    const missing = keysOf(configTree, []).filter(
      (key) => !entries.some((entry) => covers(entry, key)),
    );
    expect(missing).toStrictEqual([]);
  });

  it.each<[string, ApplyTime]>([
    ["engine.port", "restart"],
    ["engine.unlock.mode", "restart"],
    ["engine.shutdownBudgetMs", "restart"],
    ["custody.privy.appId", "restart"],
    ["telegram.botToken", "restart"],
    ["defaults.limits.perTradeUsd", "restart"],
    ["chains.rpc.eip155:56.tracer", "restart"],
    ["network.proxy", "restart"],
    ["owner.locale", "now"],
    ["logging.level", "now"],
    ["backups.copyTo", "now"],
    ["telegram.topicsPerAgent", "now"],
    ["plugins.example.colour", "now"],
    ["a.key.no.entry.covers", "restart"],
  ])("judges %s as %s", (path, time) => {
    expect(applyTimeOf({ path, after: 1 }, started)).toBe(time);
  });
});
