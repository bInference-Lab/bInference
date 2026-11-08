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
    expect(migrateConfig(ninth, configMigrations.slice(0, 9))).toMatchObject({
      ok: true,
      file: { ...ninth, version: 10 },
      steps: [{ from: 9, to: 10, edits: [] }],
    });
  });

  it("moves a version 10 file to version 11 without the health factor, saying why", () => {
    const limits = { perTradeUsd: "50", minHealthFactor: 1.8 };
    const tenth: JsonObject = { version: 10, defaults: { limits } };
    const migrated = migrateConfig(tenth, configMigrations.slice(0, 10));
    expect(migrated).toStrictEqual({
      ok: true,
      file: { version: 11, defaults: { limits: { perTradeUsd: "50" } } },
      steps: [
        {
          from: 10,
          to: 11,
          summary:
            "Removes defaults.limits.minHealthFactor: binference does not lend or borrow, so no " +
            "limit holds a health factor.",
          edits: [{ kind: "remove", path: ["defaults", "limits", "minHealthFactor"] }],
        },
      ],
    });
    const without: JsonObject = { version: 10, defaults: { limits: { perTradeUsd: "50" } } };
    expect(migrateConfig(without, configMigrations.slice(0, 10))).toMatchObject({
      ok: true,
      steps: [{ from: 10, to: 11, edits: [] }],
    });
  });

  it("moves a version 11 file to version 12 unchanged, naming the Relay key it adds", () => {
    const eleventh: JsonObject = { version: 11, venues: { kyberClientId: "binference" } };
    expect(migrateConfig(eleventh, configMigrations.slice(0, 11))).toStrictEqual({
      ok: true,
      file: { version: 12, venues: { kyberClientId: "binference" } },
      steps: [
        {
          from: 11,
          to: 12,
          summary: "Adds venues.keys.relay, the owner's Relay API key, which no file sets yet.",
          edits: [],
        },
      ],
    });
  });

  it("moves a version 12 file to version 13 unchanged, naming the notice it lets be muted", () => {
    const muted = { notifications: { muted: ["alertHeld"] } };
    const twelfth: JsonObject = { version: 12, defaults: muted };
    expect(migrateConfig(twelfth, configMigrations.slice(0, 12))).toStrictEqual({
      ok: true,
      file: { version: 13, defaults: muted },
      steps: [
        {
          from: 12,
          to: 13,
          summary:
            "Lets defaults.notifications mute claimReady, the notice that an unstake's coin can " +
            "be claimed; no file names it yet.",
          edits: [],
        },
      ],
    });
  });

  it("moves a version 13 file to version 14 without the Telegram keys no part read", () => {
    const telegram = {
      botToken: { fromEnv: "BOT" },
      groups: true,
      confirmBotToken: { fromKeychain: "confirm-bot" },
    };
    const thirteenth: JsonObject = { version: 13, telegram };
    expect(migrateConfig(thirteenth, configMigrations.slice(0, 13))).toStrictEqual({
      ok: true,
      file: { version: 14, telegram: { botToken: { fromEnv: "BOT" } } },
      steps: [
        {
          from: 13,
          to: 14,
          summary:
            "Removes telegram.groups and telegram.confirmBotToken, which no part of binference " +
            "read: the bot answers only the owner's private chat. They return with the work that " +
            "builds them.",
          edits: [
            { kind: "remove", path: ["telegram", "groups"] },
            { kind: "remove", path: ["telegram", "confirmBotToken"] },
          ],
        },
      ],
    });
    const without: JsonObject = { version: 13, telegram: { botToken: { fromEnv: "BOT" } } };
    expect(migrateConfig(without, configMigrations.slice(0, 13))).toMatchObject({
      ok: true,
      steps: [{ from: 13, to: 14, edits: [] }],
    });
  });

  it("moves a version 14 file to version 15 unchanged, naming the reply mode it adds", () => {
    const fourteenth: JsonObject = { version: 14, telegram: { botToken: { fromEnv: "BOT" } } };
    expect(migrateConfig(fourteenth, configMigrations.slice(0, 14))).toStrictEqual({
      ok: true,
      file: { version: 15, telegram: { botToken: { fromEnv: "BOT" } } },
      steps: [
        {
          from: 14,
          to: 15,
          summary:
            'Adds telegram.replies.stream, how the agent\'s replies show while it works, at "progress": ' +
            "a status message once the agent works, then the answer as a new message.",
          edits: [],
        },
      ],
    });
  });

  it("moves a version 15 file to version 16 unchanged, the reasoning hidden", () => {
    const fifteenth: JsonObject = { version: 15, telegram: { replies: { stream: "partial" } } };
    expect(migrateConfig(fifteenth, configMigrations.slice(0, 15))).toStrictEqual({
      ok: true,
      file: { version: 16, telegram: { replies: { stream: "partial" } } },
      steps: [
        {
          from: 15,
          to: 16,
          summary:
            "Adds telegram.replies.reasoning, how the model's reasoning shows in Telegram, at " +
            '"off": the owner sees no reasoning until they choose to.',
          edits: [],
        },
      ],
    });
  });

  it("moves a version 16 file to version 17 unchanged, the shell on", () => {
    const sixteenth: JsonObject = { version: 16, logging: { level: "debug" } };
    expect(migrateConfig(sixteenth, configMigrations.slice(0, 16))).toStrictEqual({
      ok: true,
      file: { version: 17, logging: { level: "debug" } },
      steps: [
        {
          from: 16,
          to: 17,
          summary:
            'Adds shell, the agent\'s commands on this machine, at run "any" with a 1800-second ' +
            "limit: the agent runs commands away from binference's own folder until the owner " +
            "sets off.",
          edits: [],
        },
      ],
    });
  });

  it("moves a version 20 file to version 21 unchanged, the agent's browser on", () => {
    const twentieth: JsonObject = { version: 20, logging: { level: "debug" } };
    const migrated = migrateConfig(twentieth, configMigrations.slice(0, 20));
    expect(migrated).toMatchObject({
      ok: true,
      file: { version: 21, logging: { level: "debug" } },
      steps: [{ from: 20, to: 21, edits: [] }],
    });
  });

  it("moves a version 21 file to version 22 unchanged, no video or speech model named", () => {
    const twentyFirst: JsonObject = { version: 21, models: { imageMaking: "binference/x/y" } };
    const migrated = migrateConfig(twentyFirst, configMigrations.slice(0, 21));
    expect(migrated).toMatchObject({
      ok: true,
      file: { version: 22, models: { imageMaking: "binference/x/y" } },
      steps: [{ from: 21, to: 22, edits: [] }],
    });
  });

  it("keeps the shipped migrations in order, one version each", () => {
    expect(() => {
      assertMigrationOrder(configMigrations);
    }).not.toThrow();
    expect(currentConfigVersion).toBe(configMigrations.length + 1);
  });
});
