import { describe, expect, it } from "vitest";
import type { JsonObject } from "../json-value.schema.js";
import { configMigrations, currentConfigVersion } from "./config-migrations.js";
import {
  assertMigrationOrder,
  type ConfigMigration,
  fileVersion,
  migrateConfig,
  type MigrationOutcome,
} from "./migrate-config.js";

// Two shapes ago `engine.listenPort` held the port; one shape ago `chats.keep` became `keepDays`.
const renamePort: ConfigMigration = {
  from: 1,
  summary: "engine.listenPort is now engine.port.",
  edits: () => [{ kind: "move", from: ["engine", "listenPort"], to: ["engine", "port"] }],
};
const renameKeep: ConfigMigration = {
  from: 2,
  summary: "chats.keep is now chats.keepDays, and the old logging.color switch is gone.",
  edits: (file) => [
    { kind: "move", from: ["chats", "keep"], to: ["chats", "keepDays"] },
    ...(file["logging"] === undefined
      ? []
      : [{ kind: "remove", path: ["logging", "color"] } as const]),
  ],
};
const migrations = [renamePort, renameKeep];

function migratedFile(outcome: MigrationOutcome): JsonObject {
  if (!outcome.ok) {
    throw new Error(`refused: ${outcome.problem.kind}`);
  }
  return outcome.file;
}

const oldFile: JsonObject = {
  version: 1,
  engine: { listenPort: 7460, webhookPort: 7461 },
  chats: { keep: 30 },
  logging: { level: "debug", color: true },
};

describe("migrate config", () => {
  it("runs each migration in order and names what each one changed", () => {
    const migrated = migrateConfig(oldFile, migrations);
    expect(migrated).toStrictEqual({
      ok: true,
      file: {
        version: 3,
        engine: { webhookPort: 7461, port: 7460 },
        chats: { keepDays: 30 },
        logging: { level: "debug" },
      },
      steps: [
        {
          from: 1,
          to: 2,
          summary: "engine.listenPort is now engine.port.",
          edits: [{ kind: "move", from: ["engine", "listenPort"], to: ["engine", "port"] }],
        },
        {
          from: 2,
          to: 3,
          summary: "chats.keep is now chats.keepDays, and the old logging.color switch is gone.",
          edits: [
            { kind: "move", from: ["chats", "keep"], to: ["chats", "keepDays"] },
            { kind: "remove", path: ["logging", "color"] },
          ],
        },
      ],
    });
  });

  it("changes nothing the second time, so it is safe to run again", () => {
    const once = migratedFile(migrateConfig(oldFile, migrations));
    expect(migrateConfig(once, migrations)).toStrictEqual({ ok: true, file: once, steps: [] });
  });

  it("starts at the file's own version and leaves its input untouched", () => {
    const middle: JsonObject = { version: 2, chats: { keep: 7 } };
    expect(migrateConfig(middle, migrations)).toMatchObject({
      ok: true,
      file: { version: 3, chats: { keepDays: 7 } },
      steps: [{ from: 2, to: 3 }],
    });
    expect(middle).toStrictEqual({ version: 2, chats: { keep: 7 } });
  });

  it("refuses a file from a newer binference", () => {
    expect(migrateConfig({ version: 4 }, migrations)).toStrictEqual({
      ok: false,
      problem: { kind: "newer_version", version: 4, supported: 3 },
    });
  });

  it("reads a file without a version as version 1", () => {
    expect(fileVersion({})).toBe(1);
    expect(fileVersion({ version: 2 })).toBe(2);
    expect(fileVersion({ version: "2" })).toBeUndefined();
  });

  it("refuses a list of migrations with a gap", () => {
    expect(() => {
      assertMigrationOrder([renameKeep]);
    }).toThrow(expect.objectContaining({ code: "config.migrations_out_of_order" }));
  });

  it("moves a version 2 file to version 3 without changing a value, with no tracing RPC", () => {
    const second: JsonObject = { version: 2, chains: { rpc: {} } };
    expect(migrateConfig(second, configMigrations.slice(0, 2))).toMatchObject({
      ok: true,
      file: { ...second, version: 3 },
      steps: [{ from: 2, to: 3, edits: [] }],
    });
  });

  it("moves a version 1 file to version 2 without changing a value, so the fee cap takes its default", () => {
    const first: JsonObject = { version: 1, telegram: { botToken: { fromKeychain: "bot" } } };
    expect(migrateConfig(first, configMigrations.slice(0, 1))).toStrictEqual({
      ok: true,
      file: { ...first, version: 2 },
      steps: [
        {
          from: 1,
          to: 2,
          summary:
            "Adds chains.maxFeePerGasGwei, the network fee cap of each chain, at its default.",
          edits: [],
        },
      ],
    });
  });

  it.each([
    ["duckduckgo", [{ kind: "remove", path: ["search", "provider"] }]],
    ["brave", []],
  ])("moves a version 7 file to version 8 with the search provider %s", (provider, edits) => {
    const seventh: JsonObject = { version: 7, search: { provider } };
    expect(migrateConfig(seventh, configMigrations.slice(0, 7))).toMatchObject({
      ok: true,
      steps: [{ from: 7, to: 8, edits }],
    });
  });

  it("moves a version 8 file to version 9 without a change, so the image input list starts empty", () => {
    const eighth: JsonObject = { version: 8, models: { vision: "router/eyes" } };
    expect(migrateConfig(eighth, configMigrations.slice(0, 8))).toMatchObject({
      ok: true,
      file: { ...eighth, version: 9 },
      steps: [{ from: 8, to: 9, edits: [] }],
    });
  });

  it("moves a version 9 file to version 10 without a change, so alertHeld may be muted", () => {
    const ninth: JsonObject = { version: 9, defaults: { notifications: { muted: ["fill"] } } };
    expect(migrateConfig(ninth, configMigrations)).toMatchObject({
      ok: true,
      file: { ...ninth, version: 10 },
      steps: [{ from: 9, to: 10, edits: [] }],
    });
  });

  it("keeps the shipped migrations in order, one version each", () => {
    expect(() => {
      assertMigrationOrder(configMigrations);
    }).not.toThrow();
    expect(currentConfigVersion).toBe(configMigrations.length + 1);
  });
});
