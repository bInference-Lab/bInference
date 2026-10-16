import { err, ok } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import { createMemoryConfigJournal } from "@binference/engine/testing";
import type { FilePermissions, WatchFileOptions } from "@binference/platform";
import type { ArgsOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load-config.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { createClosers } from "./closers.js";
import { createConfigCell } from "./config-cell.js";
import { startConfigReload } from "./config-reload.js";
import { createOwnerLocaleChange } from "./owner-locale-change.js";

const live = () => ({ signal: new AbortController().signal });
const file = "/state/config.json5";
const text = `// Written by binference init.
{
  version: ${String(currentConfigVersion)},
  // The owner's language.
  owner: { locale: "en" },
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
}
`;
const telegram: EngineCaller = {
  credential: "tg:7012345678",
  client: { kind: "telegram" },
  scopes: ["read", "confirm"],
};
const permissions: FilePermissions = {
  restrictFile: async () => Promise.resolve(),
  syncFolder: async () => Promise.resolve(),
  restrictFolder: async () => Promise.resolve(),
};

// A disk of one config file, the config read from it in its layers, and the live reload over it.
async function machine(start: string | undefined = text) {
  const disk = new Map(start === undefined ? [] : [[file, start]]);
  const readFile = async (path: string) => {
    const held = disk.get(path);
    return Promise.resolve(held === undefined ? err("not_found" as const) : ok(held));
  };
  const writes: string[] = [];
  const writeFile = async (path: string, data: string | Uint8Array) => {
    writes.push(path);
    disk.set(path, String(data));
    await Promise.resolve();
  };
  const system = { locale: "en", timezone: "UTC", unlockMode: "keychain" } as const;
  const readConfig = async (signal: AbortSignal) =>
    loadConfig({ file, env: {}, sets: [], system, signal, readFile });
  const loaded = await readConfig(live().signal);
  if (!loaded.ok) {
    throw new Error("Expected the fixture config to load.");
  }
  const settings = createConfigCell(loaded.config);
  const change = createOwnerLocaleChange({ file, permissions, settings, readFile, writeFile });
  return { disk, writes, settings, change, readConfig };
}

async function setLocale(
  change: Awaited<ReturnType<typeof machine>>["change"],
  patch: ArgsOf<"config/change">["patch"],
) {
  return change({ args: { patch }, caller: telegram, ...live() });
}

describe("the owner's language changed from Telegram", () => {
  it("sets the owner's language in the config file, keeps the rest, and shows secrets by kind", async () => {
    const test = await machine();
    const answered = await setLocale(test.change, { owner: { locale: "zh" } });
    expect(test.disk.get(file)).toBe(text.replace('locale: "en"', 'locale: "zh"'));
    expect(answered).toMatchObject({
      ok: true,
      value: {
        restartNeeded: false,
        config: { owner: { locale: "zh" }, telegram: { botToken: "fromEnv" } },
      },
    });
  });

  it("is journaled, announced and applied by the live reload of the file", async () => {
    const test = await machine();
    const clock = createManualClock(0);
    const closers = createClosers();
    const journal = createMemoryConfigJournal();
    const pushes: EnginePush[] = [];
    const watched: { onChange?: () => void } = {};
    startConfigReload({
      file,
      readConfig: test.readConfig,
      settings: test.settings,
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
    await setLocale(test.change, { owner: { locale: "zh" } });
    watched.onChange?.();
    await clock.advance(500);
    expect(test.settings.current().owner.locale).toBe("zh");
    const entries = await journal.list({ after: 0, limit: 10 }, live());
    expect(entries.map(({ path, before, after }) => [path, before, after])).toStrictEqual([
      ["owner.locale", "en", "zh"],
    ]);
    expect(
      pushes.filter((push) => push.kind === "notice/new").map((push) => push.data),
    ).toStrictEqual([
      { key: "notice.configChanged", values: { changed: "owner.locale", afterRestart: "none" } },
    ]);
    await closers.closeAll(live().signal);
  });

  it.each([
    ["a language binference does not speak", { owner: { locale: "fr" } }],
    ["another setting", { owner: { locale: "zh", timezone: "UTC" } }],
    ["a setting outside the owner", { logging: { level: "debug" } }],
  ])("refuses %s and writes nothing", async (_name, patch) => {
    const test = await machine();
    await expect(setLocale(test.change, patch)).resolves.toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(test.writes).toStrictEqual([]);
  });

  it("refuses a file it cannot edit, and writes nothing", async () => {
    const test = await machine();
    test.disk.set(file, "{ owner: null }");
    await expect(setLocale(test.change, { owner: { locale: "zh" } })).resolves.toStrictEqual({
      ok: false,
      error: "config.invalid",
    });
    test.disk.delete(file);
    await expect(setLocale(test.change, { owner: { locale: "zh" } })).resolves.toStrictEqual({
      ok: false,
      error: "config.invalid",
    });
    expect(test.writes).toStrictEqual([]);
  });
});
