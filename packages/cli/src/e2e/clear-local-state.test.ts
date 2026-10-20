import { join } from "node:path";
import { acquireFileLock, listFolderFiles, removePath } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { createSqliteConfigJournal, engineWorker, openDatabase } from "@binference/store";
import { afterEach, describe, expect, it } from "vitest";
import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import { systemDefaults } from "../program/system-defaults.js";
import { clearLocalState, type ResetRun } from "../reset/clear-local-state.js";
import {
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
  storedInstall,
} from "./init-fixtures.js";
import { noteTexts, seedNote, seedSendingTrade } from "./state-fixtures.js";
import { hostOn } from "./test-host.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const note = "the owner keeps 20% in stablecoins";

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// An install set up by `binference init`, with one note of its agent, and its engine stopped.
async function installWithNote(): Promise<InitMachine> {
  const machine = await newInitMachine(folders);
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  if (init.code !== 0) {
    throw new Error(`binference init failed: ${init.stderr}`);
  }
  await seedNote(machine, note);
  return machine;
}

async function resetRunOf(machine: InitMachine): Promise<ResetRun> {
  const host = hostOn(machine, [], secretEnv(machine));
  const platform = platformOf(host);
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal: signal(),
  });
  if (!loaded.ok) {
    throw new Error("Expected the install's config to load.");
  }
  return { host, config: loaded.config, signal: signal() };
}

async function journaled(machine: InitMachine): Promise<readonly unknown[]> {
  const database = await openDatabase({
    file: join(machine.folder, "engine.sqlite"),
    worker: engineWorker,
    readers: 0,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal: signal(),
  });
  try {
    const journal = createSqliteConfigJournal(database);
    const entries = await journal.list({ after: 0, limit: 100 }, { signal: signal() });
    return entries.filter((entry) => entry.path === "state.reset").map((entry) => entry.after);
  } finally {
    await database.close();
  }
}

// Takes the engine lock as a running engine holds it; answers how to let it go.
function holdEngineLock(machine: InitMachine): () => void {
  const lock = acquireFileLock(join(machine.folder, "engine.lock"));
  if (!lock.ok) {
    throw new Error("Expected the engine lock to be free.");
  }
  return () => lock.value.release();
}

async function backupFiles(machine: InitMachine): Promise<readonly string[]> {
  return listFolderFiles(join(machine.folder, "backups"), signal());
}

describe("clearing the local state", () => {
  it(
    "clears the notes after a checked backup, journals it and keeps the wallets",
    slow,
    async () => {
      const machine = await installWithNote();
      const before = await storedInstall(machine);

      const outcome = await clearLocalState(await resetRunOf(machine));

      expect(outcome).toMatchObject({
        kind: "reset",
        backup: { kind: "manual" },
        cleared: { notes: 1, inbox: 0, questions: 0, riskReports: 0 },
      });
      await expect(noteTexts(machine)).resolves.toStrictEqual([]);
      await expect(storedInstall(machine)).resolves.toStrictEqual(before);
      await expect(backupFiles(machine)).resolves.toHaveLength(1);
      const entries = await journaled(machine);
      expect(entries).toMatchObject([{ notes: 1, sessions: 0, events: 0 }]);
      expect(JSON.stringify(entries)).toMatch(/"backup":"bkp_[0-9a-f-]+"/);
    },
  );

  it("clears nothing and takes no backup while a live trade is on its way", slow, async () => {
    const machine = await installWithNote();
    await seedSendingTrade(machine);

    await expect(clearLocalState(await resetRunOf(machine))).resolves.toStrictEqual({
      kind: "sending",
    });

    await expect(noteTexts(machine)).resolves.toStrictEqual([note]);
    await expect(backupFiles(machine)).resolves.toStrictEqual([]);
  });

  it("clears nothing while an engine holds the state folder", slow, async () => {
    const machine = await installWithNote();
    const release = holdEngineLock(machine);
    try {
      await expect(clearLocalState(await resetRunOf(machine))).resolves.toStrictEqual({
        kind: "locked",
      });
    } finally {
      release();
    }
    await expect(noteTexts(machine)).resolves.toStrictEqual([note]);
  });

  it("clears nothing on a state folder whose engine database is gone", slow, async () => {
    const machine = await installWithNote();
    const run = await resetRunOf(machine);
    await removePath(join(machine.folder, "engine.sqlite"), signal());

    await expect(clearLocalState(run)).resolves.toStrictEqual({ kind: "unreadable" });
  });
});
