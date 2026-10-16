import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { type ApplyTime, applyTimeEntries, applyTimeOf } from "./apply-times.js";
import { configTree } from "./config-json-schema.js";
import type { ConfigNode } from "./config-tree.js";
import { currentConfigVersion } from "./migrations/config-migrations.js";
import { configSchema } from "./schema/config.schema.js";

const startedInput = {
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
};
const started = configSchema.parse(startedInput);

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

  it.each<[string, JsonValue, ApplyTime]>([
    ["engine.port", 7460, "restart"],
    ["engine.unlock.mode", "manual", "restart"],
    ["engine.shutdownBudgetMs", 20_000, "restart"],
    ["custody.privy.appId", "app", "restart"],
    ["telegram.botToken", "fromEnv", "restart"],
    ["defaults.limits.perTradeUsd", "50", "restart"],
    ["chains.rpc.eip155:56.tracer", "fromEnv", "restart"],
    ["network.proxy", "fromEnv", "restart"],
    ["owner.locale", "zh", "now"],
    ["logging.level", "debug", "now"],
    ["backups.copyTo", "/backups", "now"],
    ["telegram.topicsPerAgent", true, "now"],
    ["models.main", "test/main", "now"],
    ["search.keys.brave", "fromEnv", "now"],
    ["chains.rpc.eip155:56.urls", ["https://node.example.org"], "now"],
    ["chains.relays.eip155:56", ["blockrazor"], "now"],
    ["venues.kyberClientId", "binference-two", "now"],
    ["chains.maxFeePerGasGwei.eip155:56", "0.5", "now"],
    ["chains.maxFeePerGasGwei.eip155:56", "1", "now"],
    ["chains.maxFeePerGasGwei.eip155:56", "1.000000001", "restart"],
    ["chains.maxFeePerGasGwei.eip155:56", "0.0000000001", "restart"],
    ["chains.maxFeePerGasGwei.eip155:1", "0.5", "restart"],
    ["venues.keys.okx.apiKey", "fromEnv", "restart"],
    ["plugins.example.colour", "blue", "now"],
    ["a.key.no.entry.covers", 1, "restart"],
  ])("judges %s set to %j as %s", (path, after, time) => {
    expect(applyTimeOf({ path, after }, started)).toBe(time);
  });

  it("applies a change of the okx key at once when the engine started with one", () => {
    const withOkx = configSchema.parse({ ...startedInput, venues: { keys: { okx: okxKeys } } });
    expect(applyTimeOf({ path: "venues.keys.okx.apiKey", after: "fromEnv" }, withOkx)).toBe("now");
    expect(applyTimeOf({ path: "venues.keys.okx.secret" }, withOkx)).toBe("now");
  });
});

const okxKeys = {
  apiKey: { fromEnv: "OKX_KEY" },
  secret: { fromEnv: "OKX_SECRET" },
  passphrase: { fromEnv: "OKX_PASSPHRASE" },
};
