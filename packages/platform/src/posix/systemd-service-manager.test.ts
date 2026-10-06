import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BinferenceError, type Clock } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  serviceManagerContract,
  type ServiceManagerHarness,
} from "../contracts/service-manager-contract.js";
import type { ServiceManager } from "../ports.js";
import { runCommandToExit, type ProgramExit, type RunToExit } from "../run-command.js";
import { pollUntil } from "../service/poll-until.js";
import type { ServiceDefinition } from "../service/service-definition.js";
import { createSystemdServiceManager } from "./systemd-service-manager.js";
import { renderSystemdUnit, systemdUnitName } from "./systemd-unit.js";

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

const exit = (exitCode: number, stdout = "", stderr = ""): ProgramExit => ({
  exitCode,
  stdout,
  stderr,
});

interface Unit {
  readonly enabled: boolean;
  readonly active: boolean;
}

// Stands in for the owner's systemd user manager: daemon-reload loads the unit files of its
// folder, and it enables, starts and stops only what it has loaded.
function fakeSystemctl(unitFolder: string) {
  const fake = {
    calls: [] as string[][],
    loaded: new Map<string, Unit>(),
    startsUnits: true,
    managerAnswers: true,
  };
  const reload = (): ProgramExit => {
    const files = existsSync(unitFolder) ? readdirSync(unitFolder) : [];
    for (const unit of [...fake.loaded.keys()].filter((name) => !files.includes(name))) {
      fake.loaded.delete(unit);
    }
    for (const unit of files.filter((name) => !fake.loaded.has(name))) {
      fake.loaded.set(unit, { enabled: false, active: false });
    }
    return exit(0);
  };
  const change = (unit: string, next: (current: Unit) => Unit): ProgramExit => {
    const current = fake.loaded.get(unit);
    if (current === undefined) {
      return exit(5, "", `Unit ${unit} not found.`);
    }
    fake.loaded.set(unit, next(current));
    return exit(0);
  };
  const show = (unit: string): ProgramExit => {
    const loaded = fake.loaded.get(unit);
    return loaded === undefined
      ? exit(0, "LoadState=not-found\nActiveState=inactive\nUnitFileState=\n")
      : exit(
          0,
          `LoadState=loaded\nActiveState=${loaded.active ? "active" : "failed"}\n` +
            `UnitFileState=${loaded.enabled ? "enabled" : "disabled"}\n`,
        );
  };
  const answer = (args: readonly string[]): ProgramExit => {
    const [command = "", ...rest] = args;
    const unit = rest.find((arg) => arg.endsWith(".service")) ?? "";
    const answers: Record<string, () => ProgramExit> = {
      "daemon-reload": reload,
      enable: () => change(unit, (current) => ({ ...current, enabled: true })),
      restart: () => change(unit, (current) => ({ ...current, active: fake.startsUnits })),
      disable: () => change(unit, () => ({ enabled: false, active: false })),
      show: () => show(unit),
      "reset-failed": () => exit(1, "", "Unit not loaded."),
    };
    return (answers[command] ?? (() => exit(64)))();
  };
  const run: RunToExit = async (file, args, signal) => {
    signal.throwIfAborted();
    await Promise.resolve();
    fake.calls.push([file, ...args]);
    return fake.managerAnswers
      ? answer(args.slice(1))
      : exit(1, "", "Failed to connect to bus: No medium found");
  };
  return { fake, run };
}

interface Subject {
  readonly fake: ReturnType<typeof fakeSystemctl>["fake"];
  readonly run: RunToExit;
  readonly unitFolder: string;
}

async function subject(): Promise<Subject> {
  const unitFolder = join(await scratchFolder(), "systemd", "user");
  return { ...fakeSystemctl(unitFolder), unitFolder };
}

function managerOf({ run, unitFolder }: Subject) {
  return createSystemdServiceManager({ unitFolder, run });
}

const signal = (): AbortSignal => new AbortController().signal;

async function definition(): Promise<ServiceDefinition> {
  const folder = await scratchFolder();
  return {
    name: "engine",
    description: "binference engine",
    program: "/usr/bin/node",
    args: [join(folder, "engine.mjs")],
    workingFolder: folder,
    logFile: join(folder, "engine.log"),
    stopTimeoutMs: 30_000,
  };
}

const unit = systemdUnitName("engine");

function fakeHarness(): ServiceManagerHarness {
  let current: Subject | undefined;
  return {
    create: async () => {
      current = await subject();
      return { manager: managerOf(current), folder: await scratchFolder() };
    },
    leftovers: async (name) => {
      const unitName = systemdUnitName(name);
      return [
        ...(current?.fake.loaded.has(unitName) === true ? ["systemd holds the unit"] : []),
        ...(existsSync(join(current?.unitFolder ?? "", unitName))
          ? ["the unit file is there"]
          : []),
      ];
    },
  };
}
const show = [
  "systemctl",
  "--user",
  "show",
  unit,
  "--property=LoadState,ActiveState,UnitFileState",
];

// Its paths are POSIX paths, which Windows does not take as absolute.
describe.skipIf(process.platform === "win32")(
  "systemd service manager, with a fake systemctl",
  () => {
    it.each(serviceManagerContract(fakeHarness()))(
      "follows the contract: $name",
      async ({ run }) => {
        await expect(run()).resolves.toBeUndefined();
      },
    );

    it("writes the unit, reloads the manager, enables it for login and restarts it", async () => {
      const tested = await subject();
      const engine = await definition();

      await managerOf(tested).install(engine, signal());

      expect(tested.fake.calls).toStrictEqual([
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", unit],
        ["systemctl", "--user", "restart", unit],
        show,
      ]);
      await expect(readFile(join(tested.unitFolder, unit), "utf8")).resolves.toBe(
        renderSystemdUnit(engine),
      );
    });

    it("disables and stops the unit, then removes its file and forgets it", async () => {
      const tested = await subject();
      await managerOf(tested).install(await definition(), signal());

      await managerOf(tested).uninstall("engine", signal());

      expect(tested.fake.calls.slice(4)).toStrictEqual([
        show,
        ["systemctl", "--user", "disable", "--now", unit],
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "reset-failed", unit],
      ]);
      expect(existsSync(join(tested.unitFolder, unit))).toBe(false);
    });

    it("writes the unit owner-only", async () => {
      const tested = await subject();

      await managerOf(tested).install(await definition(), signal());

      expect((await stat(join(tested.unitFolder, unit))).mode & 0o777).toBe(0o600);
    });

    it("fails when the unit does not stay active after its start", async () => {
      const tested = await subject();
      tested.fake.startsUnits = false;

      await expect(managerOf(tested).install(await definition(), signal())).rejects.toMatchObject({
        code: "platform.service_failed",
      });
    });

    it("points to lingering when the user manager does not answer", async () => {
      const tested = await subject();
      tested.fake.managerAnswers = false;

      const failure = await managerOf(tested)
        .status("engine", signal())
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "platform.service_failed",
        details: { exitCode: 1, output: "Failed to connect to bus: No medium found" },
      });
      expect(String(failure)).toContain("loginctl enable-linger");
    });
  },
);

// The CI job for OS adapters sets this switch on a Linux runner with lingering on: these tests
// install real units in the runner's user manager and remove them again.
// oxlint-disable-next-line node/no-process-env -- the switch for real login items, read only here
const serviceTests = process.env["BINFERENCE_SERVICE_TESTS"] === "1";

// A real clock for the tests on the OS. The fake timers of unit tests also stop Date and
// performance, so time comes from the process's uptime, counted from the Date read at load.
const epochAtLoad = Date.now();
const uptimeAtLoad = process.uptime();
const systemClock: Clock = {
  now: () => epochAtLoad + Math.round((process.uptime() - uptimeAtLoad) * 1000),
  sleep: async (delayMs, sleepSignal) => {
    await delay(delayMs, undefined, { signal: sleepSignal });
  },
};

// Installs a program that writes down the arguments it was started with, and returns them.
async function argumentsSeenBy(manager: ServiceManager, args: readonly string[]): Promise<unknown> {
  const folder = await scratchFolder();
  const recorded = join(folder, "args.json");
  const script = join(folder, "record args.mjs");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs";\n` +
      `writeFileSync(${JSON.stringify(recorded)}, JSON.stringify(process.argv.slice(2)));\n` +
      "setInterval(() => {}, 60_000);\n",
  );
  const steps = AbortSignal.timeout(60_000);
  const name = "test-args";
  try {
    await manager.install(
      {
        name,
        description: "binference test service",
        program: process.execPath,
        args: [script, ...args],
        workingFolder: folder,
        logFile: join(folder, "service.log"),
        stopTimeoutMs: 5000,
      },
      steps,
    );
    await pollUntil(
      systemClock,
      {
        isDone: async () => existsSync(recorded),
        until: systemClock.now() + 10_000,
        failure: () => new BinferenceError({ code: "test.no_args", message: "No args file." }),
      },
      steps,
    );
    return JSON.parse(await readFile(recorded, "utf8"));
  } finally {
    await manager.uninstall(name, steps);
  }
}

const trickyArgs = ['a "quoted" value', "back\\slash\\", "$HOME", "two  spaces"];

const unitFolder = join(homedir(), ".config", "systemd", "user");
const systemd = (): ServiceManager => createSystemdServiceManager({ unitFolder });

const systemdHarness: ServiceManagerHarness = {
  create: async () => ({ manager: systemd(), folder: await scratchFolder() }),
  leftovers: async (name) => {
    const unitName = systemdUnitName(name);
    const args = ["--user", "show", unitName, "--property=LoadState"];
    const shown = await runCommandToExit("systemctl", args, signal());
    return [
      ...(shown.stdout.trim() === "LoadState=not-found" ? [] : ["systemd holds the unit"]),
      ...(existsSync(join(unitFolder, unitName)) ? ["the unit file is there"] : []),
      ...(existsSync(join(unitFolder, "default.target.wants", unitName))
        ? ["the login link is there"]
        : []),
    ];
  },
};

describe.runIf(serviceTests && process.platform === "linux")("systemd on Linux", () => {
  it.each(serviceManagerContract(systemdHarness))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    60_000,
  );

  it("starts the program with each argument as it was given", async () => {
    await expect(argumentsSeenBy(systemd(), trickyArgs)).resolves.toStrictEqual(trickyArgs);
  }, 60_000);
});
