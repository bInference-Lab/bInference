import { join } from "node:path";
import { createMemorySecretStore } from "@binference/core/testing";
import type { ProgramExit } from "@binference/platform";
import { fileSize, readTextFile, writePrivateFile } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import {
  type CliRun,
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
} from "./init-fixtures.js";
import { seedSendingTrade } from "./state-fixtures.js";
import type { HostParts } from "./test-host.js";
import { freePort, hostWith, isUnlocked, noPermissions, testSystem } from "./test-host.js";
import { createTestServices, type TestServices } from "./test-services.js";
import { createTestSigner } from "./test-signer.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const homes: Home[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.services.logout()));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

/** A machine whose state folder is `.binference` in its home folder, as the service runs it. */
interface Home {
  readonly machine: InitMachine;
  readonly home: string;
  readonly services: TestServices;
}

const envOf = (machine: InitMachine) => ({ ...secretEnv(machine), BINFERENCE_HOME: "" });

async function setUpHome(): Promise<Home> {
  const base = await newInitMachine(folders);
  const machine = { ...base, folder: join(base.folder, ".binference") };
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  if (init.code !== 0) {
    throw new Error(`binference init failed: ${init.stderr}`);
  }
  const services = createTestServices({
    script: join(machine.folder, "bin", "binference.mjs"),
    signals: machine.signals,
    host: (argv) =>
      hostWith(machine, argv, {
        env: envOf(machine),
        parts: { http: machine.world, startSigner: createTestSigner().start, homeDir: base.folder },
      }),
  });
  const home = { machine, home: base.folder, services };
  homes.push(home);
  return home;
}

async function cli(home: Home, argv: readonly string[], parts: HostParts = {}): Promise<CliRun> {
  return runOn(home.machine, argv, {
    env: envOf(home.machine),
    parts: { homeDir: home.home, serviceManager: home.services.manager, ...parts },
  });
}

async function startService(home: Home): Promise<void> {
  const port = String(await freePort());
  const started = await cli(home, ["start", "--json", "--set", `engine.port=${port}`]);
  expect(started.code).toBe(0);
}

// The entry script as `npm i -g binference` lays it out under the prefix `<home>/npm`.
function npmEntry(home: Home): HostParts {
  const script = join(home.home, "npm", "lib", "node_modules", "binference", "dist", "main.mjs");
  return { entry: { node: join(home.home, "bin", "node"), nodeOptions: [], script } };
}

// Records each program run and answers it as npm does after a removal.
function recorder() {
  const runs: (readonly [string, readonly string[]])[] = [];
  const runProgram = async (file: string, args: readonly string[]): Promise<ProgramExit> => {
    runs.push([file, args]);
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };
  return { runs, runProgram };
}

// Adds a key to the install's config.json5, before its closing brace.
async function addToConfig(home: Home, line: string): Promise<void> {
  const config = join(home.machine.folder, "config.json5");
  const text = await readTextFile(config, signal());
  if (!text.ok) {
    throw new Error("Expected binference init to write config.json5.");
  }
  const files = { permissions: noPermissions, signal: signal() };
  await writePrivateFile(config, `${text.value.replace(/\}\s*$/, "")}  ${line}\n}\n`, files);
}

// Answers as npm does when it cannot remove a package.
async function npmFails(): Promise<ProgramExit> {
  return Promise.resolve({ exitCode: 1, stdout: "", stderr: "EACCES" });
}

async function serviceState(home: Home): Promise<string> {
  return (await home.services.manager.status("engine", signal())).state;
}

async function exists(path: string): Promise<boolean> {
  return (await fileSize(path, signal())).ok;
}

describe("binference uninstall", () => {
  it(
    "stops binference, removes the service and the program, and keeps the state folder",
    slow,
    async () => {
      const home = await setUpHome();
      await startService(home);
      const npm = recorder();

      const removed = await cli(home, ["uninstall", "--yes", "--json"], {
        ...npmEntry(home),
        runProgram: npm.runProgram,
      });

      expect([removed.code, removed.stderr]).toStrictEqual([0, ""]);
      expect(JSON.parse(removed.stdout)).toStrictEqual({
        service: "removed",
        state: "kept",
        keychain: [],
        program: "removed",
      });
      await expect(serviceState(home)).resolves.toBe("not_installed");
      expect(isUnlocked(home.machine.folder)).toBe(true);
      expect(npm.runs).toStrictEqual([
        ["npm", ["uninstall", "--global", "--prefix", join(home.home, "npm"), "binference"]],
      ]);
      await expect(exists(join(home.machine.folder, "config.json5"))).resolves.toBe(true);
    },
  );

  it("removes the state folder and the install's keychain entries with --state", slow, async () => {
    const home = await setUpHome();
    await addToConfig(home, `search: { keys: { brave: { fromKeychain: "brave-search" } } },`);
    const config = join(home.machine.folder, "config.json5");
    const keychain = createMemorySecretStore({ "brave-search": "key", "other-app": "kept" });
    await startService(home);

    const removed = await cli(home, ["uninstall", "--state", "--yes"], { keychain });

    expect([removed.code, removed.stderr]).toStrictEqual([0, ""]);
    expect(removed.stdout).toContain("Your wallets and what they hold stay in Privy.");
    expect(removed.stdout).toContain("The owner key is not in the state folder");
    expect(removed.stdout).toContain(
      `The state folder ${home.machine.folder} is removed, with 1 keychain entry: brave-search.`,
    );
    await expect(exists(config)).resolves.toBe(false);
    await expect(exists(join(home.machine.folder, "engine.sqlite"))).resolves.toBe(false);
    await expect(keychain.read("brave-search", signal())).resolves.toMatchObject({ ok: false });
    await expect(keychain.read("other-app", signal())).resolves.toMatchObject({ ok: true });
    await expect(serviceState(home)).resolves.toBe("not_installed");
  });

  it("asks for the typed phrase at a terminal and goes on once it is typed", slow, async () => {
    const home = await setUpHome();
    const prompter = createScriptedPrompter({ uninstallConfirm: ["yes", "uninstall"] });

    const removed = await cli(home, ["uninstall"], { prompter });

    expect(removed.code).toBe(0);
    expect(prompter.transcript.asked).toStrictEqual(["uninstallConfirm", "uninstallConfirm"]);
    expect(prompter.transcript.lines).toStrictEqual([
      "Type uninstall to go on, or press Ctrl+C to keep binference.",
    ]);
    expect(removed.stdout).toContain("This machine had no background service to remove.");
    expect(removed.stdout).toContain(`binference runs from ${home.machine.folder}, which npm`);
  });

  it("refuses with nobody to answer and no --yes, and removes nothing", slow, async () => {
    const home = await setUpHome();
    await startService(home);

    const refused = await cli(home, ["uninstall", "--state"]);

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("binference uninstall asks you to type uninstall first.");
    await expect(serviceState(home)).resolves.toBe("running");
    await expect(exists(join(home.machine.folder, "config.json5"))).resolves.toBe(true);
  });

  it("leaves the program for the owner to remove on Windows", slow, async () => {
    const home = await setUpHome();
    const npm = recorder();

    const removed = await cli(home, ["uninstall", "--yes"], {
      ...npmEntry(home),
      runProgram: npm.runProgram,
      system: { ...testSystem, os: "win32" },
    });

    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain(
      "remove binference once this command ends: npm uninstall --global binference",
    );
    expect(npm.runs).toStrictEqual([]);
  });

  it("says how to remove the program when npm fails", slow, async () => {
    const home = await setUpHome();
    const removed = await cli(home, ["uninstall", "--yes", "--json"], {
      ...npmEntry(home),
      runProgram: npmFails,
    });

    expect(removed.code).toBe(1);
    expect(JSON.parse(removed.stdout)).toMatchObject({ program: "failed" });
  });

  it("keeps the state folder while a live trade is being sent", slow, async () => {
    const home = await setUpHome();
    await seedSendingTrade(home.machine);

    const refused = await cli(home, ["uninstall", "--state", "--yes"]);

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      "A live trade was still being sent, so the state folder stays.",
    );
    await expect(exists(join(home.machine.folder, "engine.sqlite"))).resolves.toBe(true);
  });

  it("never removes a folder that holds the home folder", slow, async () => {
    const home = await setUpHome();

    const refused = await runOn(home.machine, ["uninstall", "--state", "--yes"], {
      env: { ...secretEnv(home.machine), BINFERENCE_HOME: home.home },
      parts: { homeDir: home.home, serviceManager: home.services.manager },
    });

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`${home.home} holds no config.json5 and no engine.sqlite`);
    await expect(exists(join(home.machine.folder, "config.json5"))).resolves.toBe(true);
  });
});
