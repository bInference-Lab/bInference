import { createScriptedHttp, createMemoryLogger } from "@binference/core/testing";
import { createMemoryCredentialStore } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { type BinferenceConfig, configSchema } from "../config/schema/config.schema.js";
import { engineRequestsOf } from "./compose-requests.js";

const signal = new AbortController().signal;

const configWith = (remote: object): BinferenceConfig =>
  configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    remote,
  });

describe("the agent's API calls as the engine gets them", () => {
  it("never reaches the host of the public address as the config holds it now", () => {
    let config = configWith({});
    const requests = engineRequestsOf({
      http: createScriptedHttp([]),
      credentials: createMemoryCredentialStore(),
      config: () => config,
      logger: createMemoryLogger({ subsystem: "engine" }),
    });
    expect(requests.ownHosts()).toStrictEqual([]);
    config = configWith({ publicUrl: "https://mac.tail1234.ts.net/" });
    expect(requests.ownHosts()).toStrictEqual(["mac.tail1234.ts.net"]);
  });

  it("reads a credential's value from the engine's store, and logs under requests", async () => {
    const credentials = createMemoryCredentialStore();
    const allowedHosts = ["api.example.com"];
    await credentials.put({ name: "API_KEY", value: "k-1", allowedHosts, atMs: 1 }, { signal });
    const logger = createMemoryLogger({ subsystem: "engine" });
    const requests = engineRequestsOf({
      http: createScriptedHttp([]),
      credentials,
      config: () => configWith({}),
      logger,
    });
    const stored = await requests.reveal("API_KEY", { signal });
    expect([stored?.value.reveal(), stored?.allowedHosts]).toStrictEqual(["k-1", allowedHosts]);
    await expect(requests.reveal("NO_KEY", { signal })).resolves.toBeUndefined();
    requests.logger?.info("request.sent");
    expect(logger.records().map(({ subsystem }) => subsystem)).toStrictEqual(["engine.requests"]);
  });
});
