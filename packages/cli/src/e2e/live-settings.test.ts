import type { ProtocolClient } from "@binference/client";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import { startInProcessRuntime } from "@binference/runtime/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { StartRuntime } from "../agent-runtime/start-runtime.js";
import { isObject } from "../config/shown-config.js";
import { type InitMachine, secretEnv } from "./init-fixtures.js";
import { connectClient } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// Y14: each key spec 2 marks live, changed in a running engine through `config/change`, reaches
// the part that uses it, and the answer never asks for a restart. One engine serves every row, in
// order, as an owner would change one setting after another.
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
const env = {
  TEST_MODEL_KEY: "sk-test-model",
  TEST_BRAVE_KEY: "brave-test-key",
  TEST_X_KEY: "x-test-key",
};

const controlLine = z.looseObject({ t: z.string(), settings: jsonValueSchema.optional() });

/** Every line the engine wrote to the agent runtime, which runs in this process. */
function recordedRuntime() {
  const lines: string[] = [];
  const startRuntime: StartRuntime = async () => {
    const runtime = startInProcessRuntime();
    return Promise.resolve({
      ...runtime,
      write: async (text: string) => {
        lines.push(...text.split("\n").filter((line) => line !== ""));
        await runtime.write(text);
      },
    });
  };
  // The settings the runtime holds now: those of the last start or settings line.
  const settings = (): JsonValue => {
    const held = lines
      .map((line) => controlLine.parse(JSON.parse(line)))
      .findLast((line) => line.t === "start" || line.t === "settings");
    return held?.settings ?? null;
  };
  return { startRuntime, settings };
}

function at(value: JsonValue, path: string): JsonValue | undefined {
  return path
    .split(".")
    .reduce<JsonValue | undefined>(
      (node, key) => (node !== undefined && isObject(node) ? node[key] : undefined),
      value,
    );
}

interface Row {
  readonly key: string;
  readonly patch: Readonly<Record<string, JsonValue>>;
  /** Where the runtime's settings show the key, and the value they must show after the change. */
  readonly shows: readonly [path: string, value: JsonValue];
}

const runtimeRows: readonly Row[] = [
  {
    key: "models.providers.<name>",
    patch: {
      models: {
        providers: {
          test: {
            kind: "openai",
            baseUrl: "https://models.example.org/v1",
            apiKey: { fromEnv: "TEST_MODEL_KEY" },
          },
        },
      },
    },
    shows: [
      "models.providers.test",
      { kind: "openai", baseUrl: "https://models.example.org/v1", apiKey: "sk-test-model" },
    ],
  },
  {
    key: "models.main",
    patch: { models: { main: "test/main-b" } },
    shows: ["models.main", "test/main-b"],
  },
  {
    key: "models.fast",
    patch: { models: { fast: "test/fast-b" } },
    shows: ["models.fast", "test/fast-b"],
  },
  {
    key: "models.vision",
    patch: { models: { vision: "test/eyes" } },
    shows: ["models.vision", "test/eyes"],
  },
  {
    key: "models.fallbacks.main",
    patch: { models: { fallbacks: { main: ["test/main-c"] } } },
    shows: ["models.fallbacks.main", ["test/main-c"]],
  },
  {
    key: "models.fallbacks.fast",
    patch: { models: { fallbacks: { fast: ["test/fast-c"] } } },
    shows: ["models.fallbacks.fast", ["test/fast-c"]],
  },
  {
    key: "models.idleTimeoutMs",
    patch: { models: { idleTimeoutMs: 90_000 } },
    shows: ["models.idleTimeoutMs", 90_000],
  },
  {
    key: "models.cooldownMs",
    patch: { models: { cooldownMs: 30_000 } },
    shows: ["models.cooldownMs", 30_000],
  },
  {
    key: "models.maxToolCallsPerTurn",
    patch: { models: { maxToolCallsPerTurn: 12 } },
    shows: ["models.maxToolCallsPerTurn", 12],
  },
  {
    key: "models.loopDetection",
    patch: { models: { loopDetection: false } },
    shows: ["models.loopDetection", false],
  },
  {
    key: "models.prices.<model>",
    patch: {
      models: {
        prices: {
          "test/main-b": { inputPerMTokUsd: "1", outputPerMTokUsd: "4", cachedPerMTokUsd: "0.1" },
        },
      },
    },
    shows: ["models.prices.test/main-b.outputPerMTokUsd", "4000000"],
  },
  {
    key: "chats.newMessageMode",
    patch: { chats: { newMessageMode: "after" } },
    shows: ["chats.newMessageMode", "after"],
  },
  {
    key: "search.keys.<provider>",
    patch: { search: { keys: { brave: { fromEnv: "TEST_BRAVE_KEY" } } } },
    shows: ["search.keys.brave", "brave-test-key"],
  },
  {
    key: "search.provider",
    patch: { search: { provider: "brave" } },
    shows: ["search.provider", "brave"],
  },
  {
    key: "search.xApiKey",
    patch: { search: { xApiKey: { fromEnv: "TEST_X_KEY" } } },
    shows: ["search.xApiKey", "x-test-key"],
  },
  { key: "owner.locale", patch: { owner: { locale: "zh" } }, shows: ["owner.locale", "zh"] },
  {
    key: "owner.timezone",
    patch: { owner: { timezone: "Asia/Shanghai" } },
    shows: ["owner.timezone", "Asia/Shanghai"],
  },
];

describe("live settings in a running engine", () => {
  const running = {} as { machine: InitMachine; client: ProtocolClient };
  const runtime = recordedRuntime();

  beforeAll(async () => {
    const machine = await engines.setUp();
    await engines.start(machine, {
      env: { ...secretEnv(machine), ...env },
      parts: { startRuntime: runtime.startRuntime },
    });
    running.machine = machine;
    running.client = await connectClient(machine);
  }, 60_000);

  afterAll(async () => {
    running.client.close();
    await engines.stopAll();
  });

  it.each(runtimeRows)("sends a changed $key to the agent runtime at once", async (row) => {
    const answer = await running.client.call("config/change", { patch: row.patch }, live());
    expect(answer.restartNeeded).toBe(false);
    const [path, value] = row.shows;
    expect(at(runtime.settings(), path)).toStrictEqual(value);
  });
});
