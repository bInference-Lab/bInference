import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { createSchtasksServiceManager } from "./schtasks-service-manager.js";
import { renderTaskXml, scheduledTaskName } from "./task-xml.js";

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

// A task's program ends a moment after Task Scheduler reports it stopped, and Windows keeps its
// working folder busy until then; rm retries EBUSY with a growing wait (Node's fs.rm options).
afterEach(async () => {
  const removal = { recursive: true, maxRetries: 10, retryDelay: 200 };
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, removal)));
});

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

const sid = "S-1-5-21-1004336348-1177238915-682003330-1001";

interface Task {
  readonly xml: string;
  readonly running: boolean;
}

// Stands in for whoami, Task Scheduler's PowerShell interface and schtasks: it registers tasks
// from their XML file, runs and ends them, and reports them as the probe script asks.
function fakeTaskScheduler() {
  const fake = {
    calls: [] as string[][],
    tasks: new Map<string, Task>(),
    probesBeforeRunning: 0,
    probeOutput: undefined as string | undefined,
  };
  const probe = (encoded: string): ProgramExit => {
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    const task = fake.tasks.get(/GetTask\('([^']+)'\)/.exec(script)?.[1] ?? "");
    if (fake.probeOutput !== undefined) {
      return exit(0, fake.probeOutput);
    }
    if (task === undefined) {
      return exit(0, '{"found":false}\r\n');
    }
    fake.probesBeforeRunning = Math.max(0, fake.probesBeforeRunning - 1);
    const isRunning = task.running && fake.probesBeforeRunning === 0;
    const logon = task.xml.includes("<LogonTrigger>");
    return exit(0, JSON.stringify({ found: true, state: isRunning ? 4 : 3, enabled: true, logon }));
  };
  const create = (name: string, file: string): ProgramExit => {
    const bytes = readFileSync(file);
    const hasMark = bytes[0] === 0xff && bytes[1] === 0xfe;
    fake.tasks.set(name, { xml: bytes.subarray(2).toString("utf16le"), running: false });
    return hasMark ? exit(0) : exit(1, "", "ERROR: The task XML is malformed.");
  };
  const change = (name: string, next: Pick<Task, "running">): ProgramExit => {
    const task = fake.tasks.get(name);
    if (task === undefined) {
      return exit(1, "", "ERROR: The system cannot find the file specified.");
    }
    fake.tasks.set(name, { ...task, ...next });
    return exit(0);
  };
  const schtasks = (args: readonly string[]): ProgramExit => {
    const name = args[args.indexOf("/TN") + 1] ?? "";
    const answers: Record<string, () => ProgramExit> = {
      "/Create": () => create(name, args[args.indexOf("/XML") + 1] ?? ""),
      "/Run": () => change(name, { running: true }),
      "/End": () => change(name, { running: false }),
      "/Delete": () => exit(fake.tasks.delete(name) ? 0 : 1),
    };
    return (answers[args[0] ?? ""] ?? (() => exit(1)))();
  };
  const answer = (file: string, args: readonly string[]): ProgramExit => {
    const programs: Record<string, () => ProgramExit> = {
      whoami: () => exit(0, `"desktop-7\\owner","${sid}"\r\n`),
      "powershell.exe": () => probe(args.at(-1) ?? ""),
      schtasks: () => schtasks(args),
    };
    return (programs[file] ?? (() => exit(9009)))();
  };
  const run: RunToExit = async (file, args, signal) => {
    signal.throwIfAborted();
    await Promise.resolve();
    fake.calls.push([file, ...args.slice(0, 1)]);
    return answer(file, args);
  };
  return { fake, run };
}

interface Subject {
  readonly fake: ReturnType<typeof fakeTaskScheduler>["fake"];
  readonly run: RunToExit;
  readonly temporaryFolder: string;
  readonly clock: ReturnType<typeof steppingClock>;
}

async function subject(): Promise<Subject> {
  const temporaryFolder = await scratchFolder();
  return { ...fakeTaskScheduler(), temporaryFolder, clock: steppingClock() };
}

function managerOf({ run, temporaryFolder, clock }: Subject) {
  return createSchtasksServiceManager({ clock, temporaryFolder, run });
}

const signal = (): AbortSignal => new AbortController().signal;

const engine: ServiceDefinition = {
  name: "engine",
  description: "binference engine",
  program: "C:\\Program Files\\nodejs\\node.exe",
  args: ["D:\\binference\\state\\engine.mjs"],
  workingFolder: "D:\\binference\\state",
  logFile: "D:\\binference\\state\\logs\\service.log",
  stopTimeoutMs: 30_000,
};

const task = scheduledTaskName("engine");

function fakeHarness(): ServiceManagerHarness {
  let current: Subject | undefined;
  return {
    create: async () => {
      current = await subject();
      return { manager: managerOf(current), folder: await scratchFolder() };
    },
    leftovers: async (name) =>
      current?.fake.tasks.has(scheduledTaskName(name)) === true ? ["the task is registered"] : [],
  };
}

describe("schtasks service manager, with a fake Task Scheduler", () => {
  it.each(serviceManagerContract(fakeHarness()))("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("registers the task from UTF-16 XML, runs it and waits until it runs", async () => {
    const tested = await subject();
    tested.fake.probesBeforeRunning = 2;

    await managerOf(tested).install(engine, signal());

    expect(tested.fake.calls).toStrictEqual([
      ["powershell.exe", "-NoProfile"],
      ["whoami", "/user"],
      ["schtasks", "/Create"],
      ["schtasks", "/Run"],
      ["powershell.exe", "-NoProfile"],
      ["powershell.exe", "-NoProfile"],
    ]);
    expect(tested.fake.tasks.get(task)?.xml).toBe(renderTaskXml(engine, sid));
    expect(tested.clock.slept).toStrictEqual([250]);
    await expect(readdir(tested.temporaryFolder)).resolves.toStrictEqual([]);
  });

  it("ends a running task before it registers the new definition", async () => {
    const tested = await subject();
    await managerOf(tested).install(engine, signal());

    await managerOf(tested).install({ ...engine, args: [...engine.args, "--again"] }, signal());

    expect(tested.fake.calls.slice(5, 9)).toStrictEqual([
      ["powershell.exe", "-NoProfile"],
      ["schtasks", "/End"],
      ["powershell.exe", "-NoProfile"],
      ["whoami", "/user"],
    ]);
    expect(tested.fake.tasks.get(task)?.xml).toContain("--again");
  });

  it("refuses a % in the command, since Task Scheduler would expand it", async () => {
    const tested = await subject();

    await expect(
      managerOf(tested).install({ ...engine, args: ["%USERPROFILE%\\engine.mjs"] }, signal()),
    ).rejects.toMatchObject({ code: "platform.service_definition_invalid" });
    expect(tested.fake.calls).toStrictEqual([]);
  });

  it("reports a task without its logon trigger as not starting at login", async () => {
    const tested = await subject();
    await managerOf(tested).install(engine, signal());
    tested.fake.probeOutput = '{"found":true,"state":4,"enabled":true,"logon":false}';

    await expect(managerOf(tested).status("engine", signal())).resolves.toStrictEqual({
      state: "running",
      startsAtLogin: false,
    });
  });

  it("fails when Task Scheduler answers with something it cannot read", async () => {
    const tested = await subject();
    tested.fake.probeOutput = "Access is denied.";

    await expect(managerOf(tested).status("engine", signal())).rejects.toMatchObject({
      code: "platform.service_failed",
      details: { exitCode: 0, output: "Access is denied." },
    });
  });

  it("gives up when the task does not run within 10 seconds", async () => {
    const tested = await subject();
    tested.fake.probesBeforeRunning = 1000;

    await expect(managerOf(tested).install(engine, signal())).rejects.toMatchObject({
      code: "platform.service_failed",
    });
    expect(tested.clock.now()).toBe(10_000);
  });
});

// The CI job for OS adapters sets this switch on a Windows runner: these tests register real
// scheduled tasks for the runner's account and delete them again.
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

const schtasks = (): ServiceManager => createSchtasksServiceManager({ clock: systemClock });

const schtasksHarness: ServiceManagerHarness = {
  create: async () => ({ manager: schtasks(), folder: await scratchFolder() }),
  leftovers: async (name) => {
    const args = ["/Query", "/TN", scheduledTaskName(name)];
    const queried = await runCommandToExit("schtasks", args, signal());
    return queried.exitCode === 0 ? ["the task is registered"] : [];
  },
};

describe.runIf(serviceTests && process.platform === "win32")("schtasks on Windows", () => {
  it.each(serviceManagerContract(schtasksHarness))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    120_000,
  );

  it("starts the program with each argument as it was given", async () => {
    await expect(argumentsSeenBy(schtasks(), trickyArgs)).resolves.toStrictEqual(trickyArgs);
  }, 60_000);
});
