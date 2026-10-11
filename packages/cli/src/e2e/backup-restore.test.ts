import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import type { ManualClock } from "@binference/core/testing";
import { createFormatter } from "@binference/i18n";
import {
  ensurePrivateFolder,
  fileSize,
  listFolderFiles,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { createSqliteBackupStore, engineWorker, openDatabase } from "@binference/store";
import { afterEach, describe, expect, it } from "vitest";
import { dayOfBackup } from "../backups/backup-fixtures.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey } from "./attach-fixtures.js";
import { type InitMachine, machineOf, newOwnerKey, runOn, secretEnv } from "./init-fixtures.js";
import { freePort, hostOn, hostWith, noPermissions } from "./test-host.js";
import { createTestSigner } from "./test-signer.js";
import { createRunningEngines, stateOf } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const init = (key: string, values: Readonly<Record<string, string>> = {}): string =>
  english.message(`init.${key}`, values);
const marker = join("workspace", "after-backup.md");

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// A backup the running engine takes by hand, and its file.
async function backupOf(machine: InitMachine): Promise<string> {
  const made = await runOn(machine, ["backup", "create", "--json"]);
  expect(made.code).toBe(0);
  const files = await listFolderFiles(join(machine.folder, "backups"), signal());
  const file = files.find((name) => name.endsWith(".bnfbak"));
  if (file === undefined) {
    throw new Error("Expected a backup file.");
  }
  return join(machine.folder, "backups", file);
}

async function writeMarker(machine: InitMachine): Promise<void> {
  const files = { permissions: noPermissions, signal: signal() };
  await ensurePrivateFolder(join(machine.folder, "workspace"), files);
  await writePrivateFile(join(machine.folder, marker), "made after the backup", files);
}

// Runs `binference start --foreground` on the machine until it is ready; answers its exit.
async function startHere(machine: InitMachine): Promise<{ readonly exit: Promise<number> }> {
  const argv = [
    "start",
    "--foreground",
    "--json",
    "--set",
    `engine.port=${String(await freePort())}`,
  ];
  const host = hostWith(machine, argv, {
    env: secretEnv(machine),
    parts: { http: machine.world, startSigner: createTestSigner().start },
  });
  const exit = runCli(host);
  await Promise.race([host.waitForLine((text) => text.includes('"state":"ready"')), exit]);
  return { exit };
}

// Runs `binference backup restore` with the owner key codes a person types, and the backup's day
// for each question that asks for it, or the days given.
async function restoreOn(
  machine: InitMachine,
  restore: {
    readonly file: string;
    readonly ownerKeys: readonly string[];
    readonly genuine?: readonly string[];
  },
  port: number,
) {
  const { file, ownerKeys } = restore;
  const day = await dayOfBackup(file);
  const prompter = createScriptedPrompter({
    ownerKey: ownerKeys,
    restoreGenuine: restore.genuine ?? [day],
    restoreConfirm: [day],
  });
  const argv = ["backup", "restore", file, "--set", `engine.port=${String(port)}`];
  const host = hostWith(machine, argv, {
    env: secretEnv(machine),
    parts: { http: machine.world, startSigner: createTestSigner().start, prompter },
  });
  return { host, prompter, exit: runCli(host) };
}

// Holds a loopback port, so an engine told to listen there refuses to start.
async function holdPort(): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const port = await freePort();
  const server: Server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  const close = async (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  return { port, close };
}

// Forgets every backup the stopped machine's install recorded, as if another install wrote them.
async function forgetBackups(machine: InitMachine): Promise<void> {
  const database = await openDatabase({
    file: join(machine.folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal: signal(),
  });
  try {
    const backups = createSqliteBackupStore(database);
    const ids = (await backups.list({ signal: signal() })).map((backup) => backup.id);
    await backups.forget(ids, { signal: signal() });
  } finally {
    await database.close();
  }
}

describe("binference backup restore", () => {
  it(
    "stops the engine, puts the backup in place and starts the engine here again",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const engine = await startHere(machine);
      const file = await backupOf(machine);
      await writeMarker(machine);

      const restore = await restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());
      await expect(engine.exit).resolves.toBe(0);
      // The stop looks every 250 ms, by the machine's clock, whether the engine let go.
      await (machine.clock as ManualClock).advance(250);
      const line = await Promise.race([
        restore.host.waitForLine((text) => text.startsWith("binference is running")),
        restore.exit.then(() => `exited: ${restore.host.stderr()}`),
      ]);

      expect(line).toMatch(/^binference is running/);
      expect(restore.prompter.transcript.asked).toStrictEqual(["ownerKey", "restoreConfirm"]);
      const said = restore.prompter.transcript.lines.join("\n");
      expect(said).toContain(init("restore.startHere"));
      await expect(stateOf(machine)).resolves.toBe("ready");
      expect((await fileSize(join(machine.folder, marker), signal())).ok).toBe(false);
      const aside = await listFolderFiles(join(machine.folder, "replaced"), signal());
      expect(aside.some((path) => path.endsWith("workspace/after-backup.md"))).toBe(true);
      machine.signals.emit("SIGINT", "SIGINT");
      await expect(restore.exit).resolves.toBe(0);
    },
  );

  it(
    "puts the replaced state back when the engine does not start on the restored one",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const engine = await startHere(machine);
      const file = await backupOf(machine);
      await writeMarker(machine);
      const taken = await holdPort();

      const restore = await restoreOn(machine, { file, ownerKeys: [ownerKey] }, taken.port);
      await expect(engine.exit).resolves.toBe(0);
      await (machine.clock as ManualClock).advance(250);

      try {
        await expect(restore.exit).resolves.toBe(1);
      } finally {
        await taken.close();
      }
      const said = restore.prompter.transcript.lines.join("\n");
      expect(said).toContain(init("restore.startFailedUndone"));
      expect((await fileSize(join(machine.folder, marker), signal())).ok).toBe(true);
      expect(await listFolderFiles(join(machine.folder, "replaced"), signal())).toStrictEqual([]);
    },
  );

  it(
    "keeps a freeze made after the backup, and shows what it keeps before anything moves",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const engine = await startHere(machine);
      const file = await backupOf(machine);
      expect((await runOn(machine, ["freeze"])).code).toBe(0);
      machine.signals.emit("SIGINT", "SIGINT");
      await expect(engine.exit).resolves.toBe(0);

      const restore = await restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());

      await expect(restore.exit).resolves.toBe(0);
      const notes = restore.prompter.transcript.notes.map((note) => note.text).join("\n");
      expect(notes).toContain(init("restore.changes.kept"));
      const after = await engines.start(machine);
      expect(after).toMatchObject({ state: "ready" });
      const frozen = await runOn(machine, ["safety", "status", "--json"]);
      expect(JSON.parse(frozen.stdout)).toMatchObject({ frozen: true });
    },
  );

  it(
    "asks before it restores a file this install has no record of, and refuses a wrong day",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const engine = await startHere(machine);
      const file = await backupOf(machine);
      machine.signals.emit("SIGINT", "SIGINT");
      await expect(engine.exit).resolves.toBe(0);
      await forgetBackups(machine);
      await writeMarker(machine);

      const wrong = await restoreOn(
        machine,
        { file, ownerKeys: [ownerKey], genuine: ["2000-01-01"] },
        await freePort(),
      );
      await expect(wrong.exit).resolves.toBe(1);
      const day = await dayOfBackup(file);
      expect(wrong.host.stderr()).toBe(`${init("refused.restoreNotConfirmed", { day })}\n`);
      expect((await fileSize(join(machine.folder, marker), signal())).ok).toBe(true);
      const [shown] = wrong.prompter.transcript.notes;
      expect(shown?.text).toContain(init("restore.unknown"));

      const right = await restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());
      await expect(right.exit).resolves.toBe(0);
      expect(right.prompter.transcript.asked).toStrictEqual([
        "ownerKey",
        "restoreGenuine",
        "restoreConfirm",
      ]);
      expect((await fileSize(join(machine.folder, marker), signal())).ok).toBe(false);
    },
  );

  it("restores on an engine that is not running, and leaves it stopped", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    const engine = await startHere(machine);
    const file = await backupOf(machine);
    machine.signals.emit("SIGINT", "SIGINT");
    await expect(engine.exit).resolves.toBe(0);
    await writeMarker(machine);

    const restore = await restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());

    await expect(restore.exit).resolves.toBe(0);
    const said = restore.prompter.transcript.lines.join("\n");
    expect(said).toContain(init("restore.startYourself"));
    expect((await fileSize(join(machine.folder, marker), signal())).ok).toBe(false);
    expect((await runOn(machine, ["health"])).code).toBe(1);
  });

  it("refuses a wrong owner key three times and leaves the engine running", slow, async () => {
    const { machine } = await setUpWithOwnerKey(folders);
    await engines.start(machine);
    const file = await backupOf(machine);
    await writeMarker(machine);
    const other = newOwnerKey().code;

    const restore = await restoreOn(
      machine,
      { file, ownerKeys: [other, other, other] },
      await freePort(),
    );

    await expect(restore.exit).resolves.toBe(1);
    expect(restore.host.stderr()).toBe(`${init("refused.restoreOwnerKey")}\n`);
    await expect(stateOf(machine)).resolves.toBe("ready");
    expect((await fileSize(join(machine.folder, marker), signal())).ok).toBe(true);
  });

  it(
    "refuses a backup whose signer the wallets no longer list, before the engine stops",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      await engines.start(machine);
      const file = await backupOf(machine);
      const folder = await createTempFolder("bnf-new-");
      folders.push(folder);
      const fresh = machineOf({ ...machine, folder: folder.path, signals: new EventEmitter() });
      const prompter = createScriptedPrompter({
        ownerKey: [ownerKey],
        restoreGenuine: [await dayOfBackup(file)],
      });
      const moved = await runCli(
        hostWith(fresh, ["init", "--attach", "--restore", file], {
          env: secretEnv(fresh),
          parts: { http: fresh.world, prompter },
        }),
      );
      expect(moved).toBe(0);

      const restore = await restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());

      await expect(restore.exit).resolves.toBe(1);
      expect(restore.host.stderr()).toBe(`${init("refused.restoreOtherSigner")}\n`);
      await expect(stateOf(machine)).resolves.not.toBe("stopped");
    },
  );
});
