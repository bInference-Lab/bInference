import { BinferenceError, createSecret } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { runtimeSettingsSchema } from "@binference/runtime";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { runtimeSettingsOf } from "./runtime-settings-of.js";

// Secrets by environment variable name; a name with no value is unavailable.
const values: ReadonlyMap<string, string> = new Map([
  ["ROUTER_KEY", "sk-router"],
  ["BRAVE_KEY", "brave-key"],
]);

const secrets: SecretReader = {
  async read(path, source) {
    const value = values.get("fromEnv" in source ? source.fromEnv : "");
    if (value === undefined) {
      throw new BinferenceError({ code: "config.secret_unavailable", message: `No ${path}.` });
    }
    return Promise.resolve(createSecret(value));
  },
};

const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
  owner: { locale: "zh", timezone: "Asia/Shanghai" },
  models: {
    providers: {
      router: { kind: "binference", apiKey: { fromEnv: "ROUTER_KEY" } },
      own: {
        kind: "openai",
        baseUrl: "https://models.example.invalid/v1",
        apiKey: { fromEnv: "NONE" },
      },
    },
    main: "router/main",
  },
  search: {
    provider: "brave",
    keys: { brave: { fromEnv: "BRAVE_KEY" } },
    xApiKey: { fromEnv: "NONE" },
  },
  chats: { newMessageMode: "after" },
});

describe("runtimeSettingsOf", () => {
  it("reads each key from its source and leaves out, logged, one it cannot read", async () => {
    const logger = createMemoryLogger({ subsystem: "runtime" });
    const settings = await runtimeSettingsOf(config, {
      secrets,
      logger,
      signal: new AbortController().signal,
    });
    expect(settings.models.providers).toStrictEqual({
      router: { kind: "binference", apiKey: "sk-router" },
      own: { kind: "openai", baseUrl: "https://models.example.invalid/v1" },
    });
    expect(settings.search).toStrictEqual({ provider: "brave", keys: { brave: "brave-key" } });
    expect([settings.models.main, settings.chats.newMessageMode]).toStrictEqual([
      "router/main",
      "after",
    ]);
    expect(settings.owner).toStrictEqual({ locale: "zh", timezone: "Asia/Shanghai" });
    expect(logger.records().map((record) => record.fields)).toStrictEqual([
      { errorCode: "config.secret_unavailable" },
      { errorCode: "config.secret_unavailable" },
    ]);
    expect(runtimeSettingsSchema.safeParse(runtimeSettingsSchema.encode(settings)).success).toBe(
      true,
    );
  });
});
