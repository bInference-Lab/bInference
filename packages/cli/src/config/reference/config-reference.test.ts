import { describe, expect, it } from "vitest";
import { describeConfigSchema, renderConfigReference } from "./config-reference.js";

describe("config reference", () => {
  it("records the version and a strict JSON Schema with the secret shapes", () => {
    const snapshot = describeConfigSchema();
    expect(snapshot.version).toBe(1);
    expect(snapshot.schema).toMatchObject({
      additionalProperties: false,
      $defs: { CommandSecret: { type: "object", additionalProperties: false } },
    });
    expect(snapshot.schema).toHaveProperty(["$defs", "Secret", "anyOf", 3]);
  });

  it("lists every key with what it takes, its default and its variable", () => {
    const reference = renderConfigReference();
    expect(reference).toContain(
      "- `engine.port`: The console, Mini App and WebSocket port. Takes a number from 1024 to " +
        "65535. Default: `7456`. Variable: `BINFERENCE_ENGINE__PORT`.",
    );
    expect(reference).toContain(
      "- `telegram.botToken`: The owner's BotFather token. Takes a secret source",
    );
    expect(reference).toContain("`chains.rpc.<chain>.urls`");
    expect(reference).toContain("`BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__API_KEY`");
  });
});
