import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import { createMemoryConfigJournal } from "@binference/engine/testing";
import type { WatchFileOptions } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { configIssue } from "../config/config-issue.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { type BinferenceConfig, configSchema } from "../config/schema/config.schema.js";
import type { ConfigOutcome } from "../config/validate-config.js";
import { createClosers } from "./closers.js";
import { createConfigCell } from "./config-cell.js";
import { startConfigReload } from "./config-reload.js";

const live = () => ({ signal: new AbortController().signal });

function configWith(extra: Readonly<Record<string, unknown>>): BinferenceConfig {
  return configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    ...extra,
  });
}

function valid(config: BinferenceConfig): ConfigOutcome {
  return { ok: true, config, origins: new Map() } as never;
}

// A reload over a watch the test fires, reading whatever the test puts on disk.
function reloadOver(start: BinferenceConfig) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const journal = createMemoryConfigJournal();
  const pushes: EnginePush[] = [];
  const settings = createConfigCell(start);
  const disk = { outcome: valid(start), reads: 0 };
  const watched: { onChange?: () => void } = {};
  const logger = createMemoryLogger({ subsystem: "engine" });
  startConfigReload({
    file: "config.json5",
    readConfig: async () => {
      disk.reads += 1;
      return Promise.resolve(disk.outcome);
    },
    settings,
    journal: { journal, publish: (push) => pushes.push(push) },
    watch: (_path, options: WatchFileOptions) => {
      watched.onChange = options.onChange;
      return { close: () => undefined };
    },
    clock,
    closers,
    logger,
  });
  const save = (outcome: ConfigOutcome): void => {
    disk.outcome = outcome;
    watched.onChange?.();
  };
  return { clock, closers, journal, pushes, settings, disk, save, logger };
}

const notices = (pushes: readonly EnginePush[]) =>
  pushes.filter((push) => push.kind === "notice/new").map((push) => push.data);

describe("the settings reload", () => {
  it("journals each changed key and applies the ones read on each use, once the file settles", async () => {
    const reload = reloadOver(configWith({}));
    const next = valid(configWith({ logging: { level: "debug" }, engine: { port: 7460 } }));
    reload.save(next);
    await reload.clock.advance(300);
    reload.save(next);
    await reload.clock.advance(499);
    expect(reload.disk.reads).toBe(0);
    await reload.clock.advance(1);
    expect(reload.disk.reads).toBe(1);
    expect(reload.logger.records().map((record) => record.event)).toStrictEqual([
      "config.reloaded",
    ]);
    expect(reload.settings.current().logging.level).toBe("debug");
    const entries = await reload.journal.list({ after: 0, limit: 10 }, live());
    expect(entries.map(({ path, by, surface }) => [path, by, surface])).toStrictEqual([
      ["engine.port", "engine", "config.json5"],
      ["logging.level", "engine", "config.json5"],
    ]);
    expect(entries[1]).toMatchObject({ before: "info", after: "debug" });
    expect(reload.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(2);
    expect(notices(reload.pushes)).toStrictEqual([
      {
        key: "notice.configChanged",
        values: { changed: "engine.port, logging.level", afterRestart: "engine.port" },
      },
    ]);
    await reload.closers.closeAll(live().signal);
  });

  it("keeps the running config when the file has a problem, and names it", async () => {
    const start = configWith({});
    const reload = reloadOver(start);
    const origin = { layer: "file", name: "config.json5" } as const;
    const issues = [configIssue([], { kind: "unreadable", line: 12, column: 3 }, origin)];
    reload.save({ ok: false, issues });
    await reload.clock.advance(500);
    expect(reload.settings.current()).toBe(start);
    await expect(reload.journal.list({ after: 0, limit: 10 }, live())).resolves.toStrictEqual([]);
    expect(notices(reload.pushes)).toStrictEqual([
      { key: "notice.configInvalid", values: { problem: "unreadable", key: "", line: "12" } },
    ]);
    await reload.closers.closeAll(live().signal);
  });

  it("says nothing when a save changed no setting", async () => {
    const start = configWith({});
    const reload = reloadOver(start);
    reload.save(valid(configWith({})));
    await reload.clock.advance(500);
    expect([reload.disk.reads, reload.pushes]).toStrictEqual([1, []]);
    await reload.closers.closeAll(live().signal);
  });

  it("reloads nothing once its closer ran", async () => {
    const reload = reloadOver(configWith({}));
    await reload.closers.closeAll(live().signal);
    reload.save(valid(configWith({ logging: { level: "debug" } })));
    await reload.clock.advance(500);
    expect(reload.disk.reads).toBe(0);
  });
});
