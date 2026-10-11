import { EventEmitter } from "node:events";
import { join } from "node:path";
import { createMemoryLogger } from "@binference/core/testing";
import { createFormatter } from "@binference/i18n";
import {
  fileSize,
  listFolderFiles,
  readFilePieces,
  resolveStateFolder,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import {
  createSqliteBackupStore,
  createSqliteInstallStore,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { afterEach, describe, expect, it } from "vitest";
import { dayOfBackup, joined } from "../backups/backup-fixtures.js";
import { type BackupRun, takeBackup } from "../backups/take-backup.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey, signsWith } from "./attach-fixtures.js";
import {
  type InitMachine,
  initFlags,
  machineOf,
  newOwnerKey,
  runOn,
  secretEnv,
  storedInstall,
} from "./init-fixtures.js";
import { hostOn, hostWith, noPermissions } from "./test-host.js";
import { createRunningEngines, heldKey } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const init = (key: string, values: Readonly<Record<string, string>> = {}): string =>
  english.message(`init.${key}`, values);

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// Takes a backup of a stopped machine's install, as the engine's nightly run takes one.
async function backupOf(machine: InitMachine, run: Partial<BackupRun> = {}): Promise<string> {
  const database = await openDatabase({
    file: join(machine.folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal: signal(),
  });
  try {
    const host = hostOn(machine, []);
    const parts = {
      stateFolder: resolveStateFolder({ binferenceHome: machine.folder }),
      engineDatabase: database,
      install: createSqliteInstallStore(database),
      backups: createSqliteBackupStore(database),
      permissions: noPermissions,
      clock: machine.clock,
      random: host.random,
      logger: createMemoryLogger({ subsystem: "engine" }),
      binferenceVersion: host.version,
      workerExecArgv: host.workerExecArgv ?? [],
    };
    const taken = await takeBackup(parts, {
      kind: "daily",
      engineSchemaVersion: database.latestVersion,
      configVersion: 4,
      kept: { daily: 7, weekly: 4, beforeChanges: 3 },
      signal: signal(),
      ...run,
    });
    if (!taken.ok) {
      throw new Error(`Expected a backup, got ${taken.error}.`);
    }
    return taken.value.path;
  } finally {
    await database.close();
  }
}

// A new machine with an empty folder that reaches the same Privy app as `machine`.
async function newMachineLike(machine: InitMachine): Promise<InitMachine> {
  const folder = await createTempFolder("bnf-new-");
  folders.push(folder);
  return machineOf({ ...machine, folder: folder.path, signals: new EventEmitter() });
}

async function restore(machine: InitMachine, file: string, ownerKeys: readonly string[]) {
  const day = (await fileSize(file, signal())).ok ? [await dayOfBackup(file)] : [];
  const prompter = createScriptedPrompter({ ownerKey: ownerKeys, restoreConfirm: day });
  const argv = ["init", "--attach", "--restore", file];
  const host = hostWith(machine, argv, {
    env: secretEnv(machine),
    parts: { http: machine.world, prompter },
  });
  const code = await runCli(host);
  return { code, stderr: host.stderr(), prompter };
}

// What the machine's folder holds besides the engine lock, which init takes, and `keys/`.
async function entriesOf(machine: InitMachine): Promise<readonly string[]> {
  const files = await listFolderFiles(machine.folder, signal());
  return files.filter((path) => path !== "engine.lock" && !path.startsWith("keys/"));
}

describe("binference init --attach --restore", () => {
  it(
    "restores a backup on a new machine, which starts and signs for the wallets Privy reports",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const before = await storedInstall(machine);
      const file = await backupOf(machine);
      const fresh = await newMachineLike(machine);

      const restored = await restore(fresh, file, [ownerKey]);

      expect([restored.code, restored.stderr]).toStrictEqual([0, ""]);
      expect(restored.prompter.transcript.asked).toStrictEqual(["ownerKey", "restoreConfirm"]);
      const after = await storedInstall(fresh);
      expect(after.facts.wallets.map((wallet) => wallet.custodyWalletId)).toStrictEqual(
        before.facts.wallets.map((wallet) => wallet.custodyWalletId),
      );
      expect(after.agents.map((agent) => agent.id)).toStrictEqual(
        before.agents.map((agent) => agent.id),
      );
      expect(after.facts.custody?.agentKeyPublic).not.toBe(before.facts.custody?.agentKeyPublic);
      expect(await signsWith(fresh, await heldKey(fresh))).toBe("signed");
      expect(await engines.start(fresh)).toMatchObject({ state: "ready" });
    },
  );

  it(
    "refuses a wrong owner key three times before any chunk is read, and changes nothing",
    slow,
    async () => {
      const { machine } = await setUpWithOwnerKey(folders);
      const file = await backupOf(machine);
      const fresh = await newMachineLike(machine);
      const sent = fresh.privy.sent.length;
      const other = newOwnerKey().code;

      const refused = await restore(fresh, file, [other, other, other]);

      expect([refused.code, refused.stderr]).toStrictEqual([
        1,
        `${init("refused.restoreOwnerKey")}\n`,
      ]);
      expect(fresh.privy.sent.slice(sent)).toStrictEqual([]);
      expect(await entriesOf(fresh)).toStrictEqual([]);
    },
  );

  it("refuses a damaged backup and leaves the folder as it was", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    const file = await backupOf(machine);
    const bytes = await joined(readFilePieces(file, { signal: signal() }));
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 40) ^ 4, bytes.length - 40);
    const damaged = `${file}.damaged`;
    await writePrivateFile(damaged, bytes, { permissions: noPermissions, signal: signal() });
    const fresh = await newMachineLike(machine);

    const refused = await restore(fresh, damaged, [ownerKey]);

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.restoreDamaged", { file: damaged })}\n`,
    ]);
    expect(await entriesOf(fresh)).toStrictEqual([]);
  });

  it(
    "stops when Privy holds a wallet the backup lacks, undoes the restore and moves no wallet",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const file = await backupOf(machine);
      const later = await newMachineLike(machine);
      const second = await runOn(later, ["init", "--yes", "--json", ...initFlags(later)]);
      expect(second.code).toBe(0);
      const fresh = await newMachineLike(machine);
      const sent = fresh.privy.sent.length;

      const refused = await restore(fresh, file, [ownerKey]);

      expect([refused.code, refused.stderr]).toStrictEqual([
        1,
        `${init("refused.restoreWalletsDiffer")}\n`,
      ]);
      const said = refused.prompter.transcript.lines.join("\n");
      expect(said).toContain(init("restore.undone"));
      expect(fresh.privy.sent.slice(sent).map((request) => request.method)).not.toContain("PATCH");
      expect(await entriesOf(fresh)).toStrictEqual([]);
    },
  );

  it("refuses a backup of a newer database schema than this binference knows", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    const file = await backupOf(machine, { engineSchemaVersion: 999 });
    const fresh = await newMachineLike(machine);

    const refused = await restore(fresh, file, [ownerKey]);

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.restoreNewerSchema")}\n`,
    ]);
    expect(await entriesOf(fresh)).toStrictEqual([]);
  });

  it("refuses a file that is not there, and --restore without --attach", slow, async () => {
    const { machine } = await setUpWithOwnerKey(folders);
    const missing = join(machine.folder, "missing.bnfbak");

    const absent = await restore(machine, missing, []);
    const alone = await runOn(machine, ["init", "--restore", missing]);

    expect([absent.code, absent.stderr]).toStrictEqual([
      1,
      `${init("refused.restoreNotFound", { file: missing })}\n`,
    ]);
    expect([alone.code, alone.stderr]).toStrictEqual([
      1,
      `${init("refused.restoreNeedsAttach")}\n`,
    ]);
    expect((await fileSize(join(machine.folder, "engine.sqlite"), signal())).ok).toBe(true);
  });
});
