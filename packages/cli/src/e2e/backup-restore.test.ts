import { EventEmitter } from "node:events";
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
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey } from "./attach-fixtures.js";
import { type InitMachine, machineOf, newOwnerKey, runOn, secretEnv } from "./init-fixtures.js";
import { freePort, hostWith, noPermissions } from "./test-host.js";
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

// Runs `binference backup restore` with the owner key codes a person types.
function restoreOn(
  machine: InitMachine,
  restore: { readonly file: string; readonly ownerKeys: readonly string[] },
  port: number,
) {
  const { file, ownerKeys } = restore;
  const prompter = createScriptedPrompter({ ownerKey: ownerKeys });
  const argv = ["backup", "restore", file, "--set", `engine.port=${String(port)}`];
  const host = hostWith(machine, argv, {
    env: secretEnv(machine),
    parts: { http: machine.world, startSigner: createTestSigner().start, prompter },
  });
  return { host, prompter, exit: runCli(host) };
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

      const restore = restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());
      await expect(engine.exit).resolves.toBe(0);
      // The stop looks every 250 ms, by the machine's clock, whether the engine let go.
      await (machine.clock as ManualClock).advance(250);
      const line = await Promise.race([
        restore.host.waitForLine((text) => text.startsWith("binference is running")),
        restore.exit.then(() => `exited: ${restore.host.stderr()}`),
      ]);

      expect(line).toMatch(/^binference is running/);
      expect(restore.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
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

  it("restores on an engine that is not running, and leaves it stopped", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    const engine = await startHere(machine);
    const file = await backupOf(machine);
    machine.signals.emit("SIGINT", "SIGINT");
    await expect(engine.exit).resolves.toBe(0);
    await writeMarker(machine);

    const restore = restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());

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

    const restore = restoreOn(
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
      const prompter = createScriptedPrompter({ ownerKey: [ownerKey] });
      const moved = await runCli(
        hostWith(fresh, ["init", "--attach", "--restore", file], {
          env: secretEnv(fresh),
          parts: { http: fresh.world, prompter },
        }),
      );
      expect(moved).toBe(0);

      const restore = restoreOn(machine, { file, ownerKeys: [ownerKey] }, await freePort());

      await expect(restore.exit).resolves.toBe(1);
      expect(restore.host.stderr()).toBe(`${init("refused.restoreOtherSigner")}\n`);
      await expect(stateOf(machine)).resolves.not.toBe("stopped");
    },
  );
});
