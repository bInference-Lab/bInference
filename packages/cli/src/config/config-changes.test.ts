import { describe, expect, it } from "vitest";
import { configChanges } from "./config-changes.js";
import { currentConfigVersion } from "./migrations/config-migrations.js";
import { type BinferenceConfig, configSchema } from "./schema/config.schema.js";

// A valid config with `extra` over the minimum a file needs.
function configWith(extra: Readonly<Record<string, unknown>>): BinferenceConfig {
  return configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    ...extra,
  });
}

// A reload of `read` over `running`, on an engine that started with `running`.
function compared(running: BinferenceConfig, read: BinferenceConfig) {
  return { running, read, started: running };
}

describe("the keys a reload changed", () => {
  it("finds nothing when the config reads the same", () => {
    expect(configChanges(compared(configWith({}), configWith({})))).toStrictEqual([]);
  });

  it("names each changed key with its value before and after, and whether it applies now", () => {
    const running = configWith({ logging: { level: "info" }, engine: { port: 7456 } });
    const read = configWith({ logging: { level: "debug" }, engine: { port: 7460 } });
    expect(configChanges(compared(running, read))).toStrictEqual([
      { path: "engine.port", before: 7456, after: 7460, appliesNow: false },
      { path: "logging.level", before: "info", after: "debug", appliesNow: true },
    ]);
  });

  it("shows a secret source as its kind only, never what it names", () => {
    const running = configWith({});
    const read = configWith({ telegram: { botToken: { fromEnv: "OTHER_BOT_TOKEN" } } });
    expect(configChanges(compared(running, read))).toStrictEqual([
      { path: "telegram.botToken", before: "fromEnv", after: "fromEnv", appliesNow: false },
    ]);
  });

  it("names a key that is new or gone without the side it lacks", () => {
    const running = configWith({});
    const read = configWith({ venues: { keys: { okx: okxKeys } } });
    const found = configChanges(compared(running, read));
    expect(found).toStrictEqual([
      { path: "venues.keys.okx.apiKey", after: "fromEnv", appliesNow: false },
      { path: "venues.keys.okx.passphrase", after: "fromEnv", appliesNow: false },
      { path: "venues.keys.okx.secret", after: "fromEnv", appliesNow: false },
    ]);
    expect(configChanges(compared(read, running)).map((change) => "after" in change)).toStrictEqual(
      [false, false, false],
    );
  });
});

const okxKeys = {
  apiKey: { fromEnv: "OKX_KEY" },
  secret: { fromEnv: "OKX_SECRET" },
  passphrase: { fromEnv: "OKX_PASSPHRASE" },
};
