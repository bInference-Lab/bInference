import { err, ok } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import { createMemoryConfigJournal } from "@binference/engine/testing";
import type { WatchFileOptions } from "@binference/platform";
import type { ArgsOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load-config.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { noPermissions } from "../e2e/test-host.js";
import { createClosers } from "./closers.js";
import { createConfigCell } from "./config-cell.js";
import { createConfigChange } from "./config-change.js";
import { startConfigReload } from "./config-reload.js";

const live = () => ({ signal: new AbortController().signal });
const file = "/state/config.json5";
// The file as binference init writes it, then edited by hand.
const golden = `// The binference config file (docs/specs/config.md), written by binference init.
// Secrets are named by their sources, never written here. binference check validates it.
{
  // The config file's shape.
  version: ${String(currentConfigVersion)},
  owner: {
    // The owner's language.
    locale: "en", // for now
  },
  // The engine's port, on 127.0.0.1.
  engine: { port: 7456 },
  telegram: {
    // The bot's token, read from an environment variable.
    botToken: { fromEnv: "TEST_BOT_TOKEN" },
  },
  logging: {
    level: "info", // quiet
  },
}
`;
const cli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "admin"],
  transport: "ipc",
};
const system = { locale: "en", timezone: "UTC", unlockMode: "keychain" } as const;

// One config file on a fake disk, the running config read from it, the live reload over it, and
// the change that writes it.
async function machine() {
  const disk = new Map([[file, golden]]);
  const writes: string[] = [];
  const readFile = async (path: string) => {
    const held = disk.get(path);
    return Promise.resolve(held === undefined ? err("not_found" as const) : ok(held));
  };
  const readConfig = async (signal: AbortSignal) =>
    loadConfig({ file, env: {}, sets: [], system, signal, readFile });
  const validate = async (text: string, signal: AbortSignal) =>
    loadConfig({
      file,
      env: {},
      sets: [],
      system,
      signal,
      readFile: async () => Promise.resolve(ok(text)),
    });
  const loaded = await readConfig(live().signal);
  if (!loaded.ok) {
    throw new Error("Expected the golden config to load.");
  }
  const settings = createConfigCell(loaded.config);
  const clock = createManualClock(1_000);
  const closers = createClosers();
  const journal = createMemoryConfigJournal();
  const pushes: EnginePush[] = [];
  const watched: { onChange?: () => void } = {};
  const reload = startConfigReload({
    file,
    readConfig,
    settings,
    journal: { journal, publish: (push) => pushes.push(push) },
    follow: async () => Promise.resolve(),
    watch: (_path, options: WatchFileOptions) => {
      watched.onChange = options.onChange;
      return { close: () => undefined };
    },
    clock,
    closers,
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
  const writeFile = async (path: string, data: string | Uint8Array) => {
    writes.push(String(data));
    disk.set(path, String(data));
    // The watch sees the save, as the platform's watcher would.
    watched.onChange?.();
    await Promise.resolve();
  };
  const change = createConfigChange({
    file,
    permissions: noPermissions,
    settings,
    validate,
    reload,
    readFile,
    writeFile,
  });
  const call = async (patch: ArgsOf<"config/change">["patch"], reason?: string) =>
    change({ args: reason === undefined ? { patch } : { patch, reason }, caller: cli, ...live() });
  const entries = async () => journal.list({ after: 0, limit: 10 }, live());
  return { disk, writes, settings, clock, closers, pushes, call, entries };
}

describe("config/change", () => {
  it("changes one value in a commented file and nothing else, and says a restart applies it", async () => {
    const test = await machine();
    const answer = await test.call({ engine: { port: 7460 } }, "Another program took 7456.");
    expect(test.disk.get(file)).toBe(golden.replace("port: 7456", "port: 7460"));
    expect(answer).toMatchObject({
      ok: true,
      value: {
        restartNeeded: true,
        config: { engine: { port: 7460 }, telegram: { botToken: "fromEnv" } },
      },
    });
    await test.closers.closeAll(live().signal);
  });

  it("journals the change once, as the caller's with its reason, though the watch fires after it", async () => {
    const test = await machine();
    await test.call({ logging: { level: "debug" } }, "Find the stuck order.");
    await test.clock.advance(500);
    const entries = await test.entries();
    expect(
      entries.map(({ path, before, after, by, surface, reason }) => [
        path,
        before,
        after,
        by,
        surface,
        reason,
      ]),
    ).toStrictEqual([
      ["logging.level", "info", "debug", cli.credential, "cli", "Find the stuck order."],
    ]);
    expect(test.settings.current().logging.level).toBe("debug");
    const notices = test.pushes
      .filter((push) => push.kind === "notice/new")
      .map((push) => push.data);
    expect(notices).toStrictEqual([
      { key: "notice.configChanged", values: { changed: "logging.level", afterRestart: "none" } },
    ]);
    await test.closers.closeAll(live().signal);
  });

  it("answers that a key read on each use needs no restart", async () => {
    const test = await machine();
    await expect(test.call({ logging: { level: "warn" } })).resolves.toMatchObject({
      ok: true,
      value: { restartNeeded: false },
    });
    expect(test.disk.get(file)).toBe(
      golden.replace('level: "info", // quiet', 'level: "warn", // quiet'),
    );
    await test.closers.closeAll(live().signal);
  });

  it.each([
    ["a value the schema refuses", { engine: { port: "abc" } }, "config.invalid"],
    ["a key the schema does not know", { engine: { colour: "blue" } }, "config.invalid"],
    ["a removal of a required key", { telegram: null }, "config.invalid"],
    [
      "a secret written as text",
      { telegram: { botToken: "123456:AAAA-secret" } },
      "config.secret_inline",
    ],
  ])("writes nothing for %s", async (_name, patch, code) => {
    const test = await machine();
    await expect(test.call(patch)).resolves.toStrictEqual({ ok: false, error: code });
    expect(test.writes).toStrictEqual([]);
    expect(test.disk.get(file)).toBe(golden);
    expect(await test.entries()).toStrictEqual([]);
    await test.closers.closeAll(live().signal);
  });

  it("writes a secret as its source, in place of the source before it, and shows it by kind", async () => {
    const test = await machine();
    const answer = await test.call({ telegram: { botToken: { fromKeychain: "telegram-bot" } } });
    expect(test.disk.get(file)).toBe(
      golden.replace(
        'botToken: { fromEnv: "TEST_BOT_TOKEN" }',
        'botToken: { fromKeychain: "telegram-bot" }',
      ),
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { config: { telegram: { botToken: "fromKeychain" } } },
    });
    const entries = await test.entries();
    expect(entries.map(({ path, before, after }) => [path, before, after])).toStrictEqual([
      ["telegram.botToken", "fromEnv", "fromKeychain"],
    ]);
    await test.closers.closeAll(live().signal);
  });

  it("removes a key set to null with its own line, and keeps the comment above it", async () => {
    const test = await machine();
    await expect(test.call({ owner: { locale: null } })).resolves.toMatchObject({ ok: true });
    expect(test.disk.get(file)).toBe(golden.replace('    locale: "en", // for now\n', ""));
    await test.closers.closeAll(live().signal);
  });

  it("refuses a file it cannot edit, and a patch that is no JSON", async () => {
    const test = await machine();
    test.disk.set(file, "{ engine: ");
    await expect(test.call({ engine: { port: 7460 } })).resolves.toStrictEqual({
      ok: false,
      error: "config.invalid",
    });
    await expect(test.call({ engine: { port: Number.NaN } })).resolves.toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(test.writes).toStrictEqual([]);
    await test.closers.closeAll(live().signal);
  });
});
