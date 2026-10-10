import { join } from "node:path";
import { BinferenceError, type Clock } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { ServiceManager } from "@binference/platform";
import { createMemoryServiceManager, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import {
  type CliRun,
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
} from "./init-fixtures.js";
import { freePort, hostWith, isUnlocked } from "./test-host.js";
import { createTestServices, type TestServices } from "./test-services.js";
import { createTestSigner } from "./test-signer.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const machines: Home[] = [];
// The engine's IPC answers no sooner than the engine serves, so waits end on its answer.
const workerExecArgv = ["--conditions=@binference/source", "--import", "tsx"];

afterEach(async () => {
  await Promise.all(machines.splice(0).map(async (home) => home.services.logout()));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

/** A machine whose state folder is `.binference` in its home folder, as the service runs it. */
interface Home {
  readonly machine: InitMachine;
  /** The home folder the state folder sits in. */
  readonly home: string;
  readonly services: TestServices;
  readonly port: number;
}

// The service runs on the state folder in the home folder: no BINFERENCE_HOME.
const envOf = (machine: InitMachine) => ({ ...secretEnv(machine), BINFERENCE_HOME: "" });

function servicesOn(machine: InitMachine, home: string): TestServices {
  return createTestServices({
    script: join(machine.folder, "bin", "binference.mjs"),
    signals: machine.signals,
    host: (argv) =>
      hostWith(machine, argv, {
        env: envOf(machine),
        parts: { http: machine.world, startSigner: createTestSigner().start, homeDir: home },
      }),
  });
}

async function setUpHome(clock?: Clock): Promise<Home> {
  const base = await newInitMachine(folders, clock);
  const machine = { ...base, folder: join(base.folder, ".binference") };
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  if (init.code !== 0) {
    throw new Error(`binference init failed: ${init.stderr}`);
  }
  const home = { machine, home: base.folder, services: servicesOn(machine, base.folder) };
  const set = { ...home, port: await freePort() };
  machines.push(set);
  return set;
}

async function cli(
  home: Home,
  argv: readonly string[],
  services: ServiceManager = home.services.manager,
): Promise<CliRun> {
  return runOn(home.machine, argv, {
    env: envOf(home.machine),
    parts: { homeDir: home.home, serviceManager: services },
  });
}

async function start(home: Home): Promise<CliRun> {
  return cli(home, ["start", "--json", "--set", `engine.port=${String(home.port)}`]);
}

async function stateOf(home: Home): Promise<unknown> {
  const status = await cli(home, ["status", "--json"]);
  return status.code === 0 ? (JSON.parse(status.stdout) as { state: string }).state : status;
}

describe("binference start as the background service", () => {
  it("runs the engine as the service, waits until it serves and names its logs", slow, async () => {
    const home = await setUpHome();
    const started = await start(home);
    const { folder } = home.machine;
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({
      service: "running",
      state: "ready",
      logFile: join(folder, "logs", "engine.log"),
      serviceLog: join(folder, "logs", "service.log"),
    });
    expect(home.services.installed()).toStrictEqual({
      name: "engine",
      description: "binference engine",
      program: join(folder, "bin", "node"),
      args: [
        ...workerExecArgv,
        join(folder, "bin", "binference.mjs"),
        "start",
        "--foreground",
        "--set",
        `engine.port=${String(home.port)}`,
      ],
      workingFolder: folder,
      logFile: join(folder, "logs", "service.log"),
      stopTimeoutMs: 35_000,
    });
    await expect(stateOf(home)).resolves.toBe("ready");
  });

  it("tells a person where binference runs and where its logs are", slow, async () => {
    const home = await setUpHome();
    const started = await cli(home, ["start", "--set", `engine.port=${String(home.port)}`]);
    const logs = join(home.machine.folder, "logs");
    expect(started.stdout).toContain(
      "binference runs as a background service and starts again each time you log in.",
    );
    expect(started.stdout).toContain(`its log at ${join(logs, "engine.log")}`);
    expect(started.stdout).toContain(`the service's own output at ${join(logs, "service.log")}.`);
  });

  it("leaves a service that runs as it is at a second start", slow, async () => {
    const home = await setUpHome();
    await start(home);
    const again = await cli(home, ["start"]);
    expect(again).toMatchObject({ code: 0, stderr: "" });
    expect(again.stdout).toContain("binference already runs as the background service.");
    expect(home.services.installs()).toBe(1);
  });

  it("refuses the service while an engine runs in a terminal", slow, async () => {
    const clock = createManualClock(1_800_000_000_000);
    const home = await setUpHome(clock);
    const argv = ["start", "--foreground", "--set", `engine.port=${String(home.port)}`];
    const host = hostWith(home.machine, argv, {
      env: secretEnv(home.machine),
      parts: { http: home.machine.world, startSigner: createTestSigner().start },
    });
    const foreground = runCli(host);
    await host.waitForLine((line) => line.startsWith("binference is running"));
    const refused = await cli(home, ["start", "--json"]);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toStrictEqual({
      error: { code: "engine.already_running" },
    });
    const stopping = cli(home, ["stop", "--json"]);
    await expect(foreground).resolves.toBe(0);
    // The stop asks every 250 ms whether the engine let go of its folder.
    await clock.advance(250);
    await expect(stopping).resolves.toMatchObject({ code: 0 });
    expect(home.services.installs()).toBe(0);
  });

  it("refuses the service when BINFERENCE_HOME moves the state folder", slow, async () => {
    const home = await setUpHome();
    const refused = await runOn(home.machine, ["start"], {
      parts: { serviceManager: home.services.manager },
    });
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`BINFERENCE_HOME moves this run to ${home.machine.folder}.`);
    expect(home.services.installs()).toBe(0);
  });

  it("says why the OS did not start the service", slow, async () => {
    const home = await setUpHome();
    const refusing: ServiceManager = {
      ...createMemoryServiceManager(),
      install: async () =>
        Promise.reject(
          new BinferenceError({ code: "platform.service_failed", message: "Refused." }),
        ),
    };
    const failed = await cli(home, ["start"], refusing);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toBe(
      "The OS did not start the background service (platform.service_failed). Run `binference " +
        "start --foreground` to run binference in this terminal, or read " +
        `${join(home.machine.folder, "logs", "service.log")}.\n`,
    );
  });
});

describe("binference stop and restart", () => {
  it(
    "stops the engine and keeps the service, which the next login starts again",
    slow,
    async () => {
      const home = await setUpHome();
      await start(home);
      const stopped = await cli(home, ["stop", "--json"]);
      expect(stopped.code).toBe(0);
      expect(JSON.parse(stopped.stdout)).toStrictEqual({ state: "stopped", service: "stopped" });
      expect(isUnlocked(home.machine.folder)).toBe(true);
      const signal = new AbortController().signal;
      await expect(home.services.manager.status("engine", signal)).resolves.toEqual({
        state: "stopped",
        startsAtLogin: true,
      });
      await home.services.login();
      await expect(stateOf(home)).resolves.toBe("ready");
    },
  );

  it("says when nothing runs, on a folder set up or not", slow, async () => {
    const home = await setUpHome();
    const fresh = await newInitMachine(folders);
    const unset = { ...home, machine: { ...fresh, folder: join(fresh.folder, ".binference") } };
    const notRunning = { code: 0, stdout: "binference is not running.\n", stderr: "" };
    await expect(cli(home, ["stop"])).resolves.toStrictEqual(notRunning);
    await expect(cli({ ...unset, home: fresh.folder }, ["stop"])).resolves.toStrictEqual(
      notRunning,
    );
  });

  it("restarts the service with this run's settings", slow, async () => {
    const home = await setUpHome();
    await start(home);
    const port = await freePort();
    const restarted = await cli(home, [
      "restart",
      "--json",
      "--set",
      `engine.port=${String(port)}`,
    ]);
    expect(restarted.code).toBe(0);
    expect(JSON.parse(restarted.stdout)).toMatchObject({ service: "running", state: "ready" });
    expect(home.services.installed()?.args.at(-1)).toBe(`engine.port=${String(port)}`);
    expect(home.services.installs()).toBe(2);
  });
});

describe("binference service remove", () => {
  it("stops the engine and removes the service, and a second run finds none", slow, async () => {
    const home = await setUpHome();
    await start(home);

    const removed = await cli(home, ["service", "remove", "--json"]);
    const again = await cli(home, ["service", "remove", "--json"]);

    expect(removed.code).toBe(0);
    expect(JSON.parse(removed.stdout)).toStrictEqual({ state: "stopped", service: "removed" });
    expect(isUnlocked(home.machine.folder)).toBe(true);
    const signal = new AbortController().signal;
    await expect(home.services.manager.status("engine", signal)).resolves.toMatchObject({
      state: "not_installed",
    });
    expect(home.services.installed()).toBeUndefined();
    expect(JSON.parse(again.stdout)).toStrictEqual({ state: "stopped", service: "none" });
  });

  it("tells a person the service is gone and the state folder stays", slow, async () => {
    const home = await setUpHome();
    await start(home);

    const removed = await cli(home, ["service", "remove"]);

    expect(removed).toStrictEqual({
      code: 0,
      stdout:
        "binference stopped, and its background service is removed: it no longer starts when " +
        `you log in. The state folder ${home.machine.folder} stays.\n`,
      stderr: "",
    });
  });

  it(
    "only stops the engine of a folder BINFERENCE_HOME moves, which has no service",
    slow,
    async () => {
      const home = await setUpHome();

      const removed = await runOn(home.machine, ["service", "remove", "--json"], {
        parts: { serviceManager: home.services.manager },
      });

      expect([removed.code, JSON.parse(removed.stdout)]).toStrictEqual([
        0,
        { state: "stopped", service: "none" },
      ]);
    },
  );
});
