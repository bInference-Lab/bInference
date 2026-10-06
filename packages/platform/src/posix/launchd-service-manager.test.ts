import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
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
import { launchdLabel, renderLaunchdPlist } from "./launchd-plist.js";
import { createLaunchdServiceManager } from "./launchd-service-manager.js";

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

// Time moves only when the adapter sleeps, and each sleep returns at once.
function steppingClock(): Clock & { readonly slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => slept.reduce((sum, delayMs) => sum + delayMs, 0),
    sleep: async (delayMs) => {
      slept.push(delayMs);
      await Promise.resolve();
    },
  };
}

const exit = (exitCode: number, stdout = "", stderr = ""): ProgramExit => ({
  exitCode,
  stdout,
  stderr,
});

const labelOf = (target: string): string => target.replace("gui/501/", "");

// Stands in for launchctl in the domain gui/501: it loads plists, unloads jobs, and keeps the
// overrides that `launchctl disable` writes.
function fakeLaunchctl() {
  const fake = {
    calls: [] as string[][],
    loaded: new Set<string>(),
    disabled: new Set<string>(),
    printsBeforeRunning: 0,
    printsBeforeGone: 0,
    bootstrapExit: exit(0),
    printExit: undefined as ProgramExit | undefined,
  };
  const print = (label: string): ProgramExit => {
    if (fake.printExit !== undefined) {
      return fake.printExit;
    }
    if (!fake.loaded.has(label)) {
      fake.printsBeforeGone = Math.max(0, fake.printsBeforeGone - 1);
      return fake.printsBeforeGone > 0 ? exit(0, "\tstate = running\n") : exit(113);
    }
    fake.printsBeforeRunning = Math.max(0, fake.printsBeforeRunning - 1);
    const state = fake.printsBeforeRunning > 0 ? "spawn scheduled" : "running";
    return exit(0, `gui/501/${label} = {\n\tstate = ${state}\n}\n`);
  };
  const answer = (args: readonly string[]): ProgramExit => {
    const [command = "", first = "", second = ""] = args;
    const answers: Record<string, () => ProgramExit> = {
      print: () => print(labelOf(first)),
      "print-disabled": () =>
        exit(0, [...fake.disabled].map((label) => `\t\t"${label}" => disabled`).join("\n")),
      enable: () => exit(Number(!fake.disabled.delete(labelOf(first)))),
      bootstrap: () => {
        if (fake.bootstrapExit.exitCode === 0) {
          fake.loaded.add(basename(second, ".plist"));
        }
        return fake.bootstrapExit;
      },
      bootout: () => exit(fake.loaded.delete(labelOf(first)) ? 0 : 3),
    };
    return (answers[command] ?? (() => exit(64)))();
  };
  const run: RunToExit = async (file, args, signal) => {
    signal.throwIfAborted();
    await Promise.resolve();
    fake.calls.push([file, ...args]);
    return answer(args);
  };
  return { fake, run };
}

interface Subject {
  readonly fake: ReturnType<typeof fakeLaunchctl>["fake"];
  readonly run: RunToExit;
  readonly agentsFolder: string;
  readonly clock: ReturnType<typeof steppingClock>;
}

async function subject(): Promise<Subject> {
  const { fake, run } = fakeLaunchctl();
  return {
    fake,
    run,
    agentsFolder: join(await scratchFolder(), "LaunchAgents"),
    clock: steppingClock(),
  };
}

function managerOf({ run, agentsFolder, clock }: Subject) {
  return createLaunchdServiceManager({ clock, agentsFolder, uid: 501, run });
}

const signal = (): AbortSignal => new AbortController().signal;

async function definition(): Promise<ServiceDefinition> {
  const folder = await scratchFolder();
  return {
    name: "engine",
    description: "binference engine",
    program: "/usr/local/bin/node",
    args: [join(folder, "engine.mjs")],
    workingFolder: folder,
    logFile: join(folder, "engine.log"),
    stopTimeoutMs: 30_000,
  };
}

const target = `gui/501/${launchdLabel("engine")}`;

function fakeHarness(): ServiceManagerHarness {
  let current: Subject | undefined;
  return {
    create: async () => {
      current = await subject();
      return { manager: managerOf(current), folder: await scratchFolder() };
    },
    leftovers: async (name) => {
      const label = launchdLabel(name);
      const plist = join(current?.agentsFolder ?? "", `${label}.plist`);
      return [
        ...(current?.fake.loaded.has(label) === true ? ["launchd holds the job"] : []),
        ...((await exists(plist)) ? ["the plist is still there"] : []),
      ];
    },
  };
}

// Its paths are POSIX paths, which Windows does not take as absolute.
describe.skipIf(process.platform === "win32")(
  "launchd service manager, with a fake launchctl",
  () => {
    it.each(serviceManagerContract(fakeHarness()))(
      "follows the contract: $name",
      async ({ run }) => {
        await expect(run()).resolves.toBeUndefined();
      },
    );

    it("writes the plist, loads it into the desktop session and waits until the job runs", async () => {
      const tested = await subject();
      tested.fake.printsBeforeRunning = 2;
      const engine = await definition();
      const plist = join(tested.agentsFolder, `${launchdLabel("engine")}.plist`);

      await managerOf(tested).install(engine, signal());

      expect(tested.fake.calls).toStrictEqual([
        ["launchctl", "print", target],
        ["launchctl", "print-disabled", "gui/501"],
        ["launchctl", "bootstrap", "gui/501", plist],
        ["launchctl", "print", target],
        ["launchctl", "print", target],
      ]);
      expect(tested.clock.slept).toStrictEqual([250]);
      await expect(readFile(plist, "utf8")).resolves.toBe(renderLaunchdPlist(engine));
    });

    it("clears a launchctl disable override, so the job loads at login", async () => {
      const tested = await subject();
      tested.fake.disabled.add(launchdLabel("engine"));

      await managerOf(tested).install(await definition(), signal());

      expect(tested.fake.calls).toContainEqual(["launchctl", "enable", target]);
      await expect(managerOf(tested).status("engine", signal())).resolves.toStrictEqual({
        state: "running",
        startsAtLogin: true,
      });
    });

    it("reports a job that a disable override keeps from loading at login", async () => {
      const tested = await subject();
      await managerOf(tested).install(await definition(), signal());
      tested.fake.disabled.add(launchdLabel("engine"));

      await expect(managerOf(tested).status("engine", signal())).resolves.toStrictEqual({
        state: "running",
        startsAtLogin: false,
      });
    });

    it("unloads a running job and waits until launchd lets it go before loading the new one", async () => {
      const tested = await subject();
      const engine = await definition();
      await managerOf(tested).install(engine, signal());
      tested.fake.printsBeforeGone = 3;

      await managerOf(tested).install({ ...engine, args: [...engine.args, "--again"] }, signal());

      expect(tested.fake.calls.slice(5, 9)).toStrictEqual([
        ["launchctl", "bootout", target],
        ["launchctl", "print", target],
        ["launchctl", "print", target],
        ["launchctl", "print", target],
      ]);
      expect(tested.clock.slept).toStrictEqual([250, 250]);
    });

    it("says the desktop session is needed when launchd refuses the bootstrap", async () => {
      const tested = await subject();
      tested.fake.bootstrapExit = exit(5, "", "Bootstrap failed: 5: Input/output error");

      const failure = await managerOf(tested)
        .install(await definition(), signal())
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "platform.service_failed",
        details: { exitCode: 5, output: "Bootstrap failed: 5: Input/output error" },
      });
      expect(String(failure)).toContain("desktop session");
    });

    it("gives up when the job does not run within 10 seconds", async () => {
      const tested = await subject();
      tested.fake.printsBeforeRunning = 1000;

      await expect(managerOf(tested).install(await definition(), signal())).rejects.toMatchObject({
        code: "platform.service_failed",
      });
      expect(tested.clock.now()).toBe(10_000);
    });

    it("writes the plist owner-only", async () => {
      const tested = await subject();

      await managerOf(tested).install(await definition(), signal());

      const plist = join(tested.agentsFolder, `${launchdLabel("engine")}.plist`);
      expect((await stat(plist)).mode & 0o777).toBe(0o600);
    });

    it("fails with launchctl's answer when it cannot read a job", async () => {
      const tested = await subject();
      tested.fake.printExit = exit(1, "", "Operation not permitted");

      await expect(managerOf(tested).status("engine", signal())).rejects.toMatchObject({
        code: "platform.service_failed",
        details: { exitCode: 1, output: "Operation not permitted" },
      });
    });
  },
);

// The CI job for OS adapters sets this switch on a macOS runner: these tests load real
// LaunchAgents into the runner's desktop session and remove them again.
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

const uid = process.getuid?.() ?? 501;
const agentsFolder = join(homedir(), "Library", "LaunchAgents");
const launchd = (): ServiceManager =>
  createLaunchdServiceManager({ clock: systemClock, agentsFolder, uid });

const launchdHarness: ServiceManagerHarness = {
  create: async () => ({ manager: launchd(), folder: await scratchFolder() }),
  leftovers: async (name) => {
    const label = launchdLabel(name);
    const job = `gui/${String(uid)}/${label}`;
    const printed = await runCommandToExit("launchctl", ["print", job], signal());
    return [
      ...(printed.exitCode === 0 ? ["launchd holds the job"] : []),
      ...((await exists(join(agentsFolder, `${label}.plist`))) ? ["the plist is there"] : []),
    ];
  },
};

describe.runIf(serviceTests && process.platform === "darwin")("launchd on macOS", () => {
  it.each(serviceManagerContract(launchdHarness))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    120_000,
  );

  it("starts the program with each argument as it was given", async () => {
    await expect(argumentsSeenBy(launchd(), trickyArgs)).resolves.toStrictEqual(trickyArgs);
  }, 60_000);
});
