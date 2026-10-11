import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { err, ok, type Clock, type Result } from "@binference/core";
import type { ServiceManager } from "../ports.js";
import { runCommandToExit, type ProgramExit, type RunToExit } from "../run-command.js";
import { pollUntil } from "../service/poll-until.js";
import {
  checkServiceDefinition,
  checkServiceName,
  invalidServiceDefinition,
  type ServiceDefinition,
  type ServiceStatus,
} from "../service/service-definition.js";
import { serviceFailed } from "../service/service-failed.js";
import { ownerSidOf, whoamiUserArgs } from "./owner-sid.js";
import { parseTaskState, type TaskState } from "./task-state.schema.js";
import { renderTaskXml, scheduledTaskName } from "./task-xml.js";

/** What the Windows adapter runs its programs with, and where it writes a task's XML. */
export interface SchtasksServiceManagerOptions {
  readonly clock: Clock;
  /** Where the task's XML waits for `schtasks` to read it: the OS's temporary folder by default. */
  readonly temporaryFolder?: string;
  /** `runCommandToExit` when left out; tests pass a recorder. */
  readonly run?: RunToExit;
}

interface Schtasks {
  readonly clock: Clock;
  readonly temporaryFolder: string;
  readonly run: RunToExit;
}

type TaskRun = "absent" | "running" | "stopped";

interface Wait {
  readonly name: string;
  readonly wanted: TaskRun;
  readonly until: number;
}

const runningState = 4;
const settleTimeoutMs = 10_000;
/** `schtasks /Create /XML` reads a task file as UTF-16 little endian that starts with a byte order mark. */
function taskFileBytes(xml: string): Buffer {
  return Buffer.from(`\uFEFF${xml}`, "utf16le");
}

/** Windows PowerShell's `-EncodedCommand` takes the Base64 of a script's UTF-16 little endian text. */
function encodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** The HRESULT of ERROR_FILE_NOT_FOUND (0x80070002), which `GetTask` raises for a missing task. */
const taskMissing = -2_147_024_894;
/** TASK_TRIGGER_LOGON in the Task Scheduler scripting objects. */
const logonTrigger = 9;

/**
 * A Windows PowerShell script that asks the Task Scheduler scripting objects about one task in the
 * root folder and prints one JSON line: `{"found":false}`, or its state number, whether it is
 * enabled, and whether an enabled trigger starts it at logon. Any other fault ends the script with
 * an error.
 */
function taskStateScript(task: string): string {
  const name = `'${task.replaceAll("'", "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "$scheduler = New-Object -ComObject 'Schedule.Service'",
    "$scheduler.Connect()",
    "try {",
    `  $task = $scheduler.GetFolder('\\').GetTask(${name})`,
    "} catch {",
    `  if ($_.Exception.GetBaseException().HResult -ne ${String(taskMissing)}) { throw }`,
    `  '{"found":false}'`,
    "  exit 0",
    "}",
    "$logon = $false",
    "foreach ($trigger in $task.Definition.Triggers) {",
    `  if ($trigger.Type -eq ${String(logonTrigger)} -and $trigger.Enabled) { $logon = $true }`,
    "}",
    "[pscustomobject]@{ found = $true; state = [int]$task.State; enabled = [bool]$task.Enabled; logon = $logon } |",
    "  ConvertTo-Json -Compress",
  ].join("\r\n");
}

/** Runs `command` (the program, then its arguments); any exit code but 0 is a service fault. */
async function program(
  schtasks: Schtasks,
  command: readonly string[],
  signal: AbortSignal,
): Promise<ProgramExit> {
  const [file = "", ...args] = command;
  const exit = await schtasks.run(file, args, signal);
  if (exit.exitCode !== 0) {
    throw serviceFailed(
      `${file} ${args[0] ?? ""} failed with exit code ${String(exit.exitCode)}.`,
      exit,
    );
  }
  return exit;
}

/** What Task Scheduler reports about the service's task right now. */
async function probe(schtasks: Schtasks, name: string, signal: AbortSignal): Promise<TaskState> {
  const task = scheduledTaskName(name);
  const shell = ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand"];
  const exit = await program(schtasks, [...shell, encodedCommand(taskStateScript(task))], signal);
  const state = parseTaskState(exit.stdout);
  if (state === undefined) {
    throw serviceFailed(
      `Task Scheduler gave no state for the task ${task} that could be read.`,
      exit,
    );
  }
  return state;
}

function runOf(state: TaskState): TaskRun {
  if (!state.found) {
    return "absent";
  }
  return state.state === runningState ? "running" : "stopped";
}

async function waitFor(schtasks: Schtasks, wait: Wait, signal: AbortSignal): Promise<void> {
  const task = scheduledTaskName(wait.name);
  await pollUntil(
    schtasks.clock,
    {
      isDone: async () => runOf(await probe(schtasks, wait.name, signal)) === wait.wanted,
      until: wait.until,
      failure: () =>
        serviceFailed(
          `The task ${task} is not ${wait.wanted} after ${String(settleTimeoutMs)} ms.`,
        ),
    },
    signal,
  );
}

async function stopIfRunning(schtasks: Schtasks, name: string, signal: AbortSignal): Promise<void> {
  if (runOf(await probe(schtasks, name, signal)) !== "running") {
    return;
  }
  await program(schtasks, ["schtasks", "/End", "/TN", scheduledTaskName(name)], signal);
  const until = schtasks.clock.now() + settleTimeoutMs;
  await waitFor(schtasks, { name, wanted: "stopped", until }, signal);
}

// Task Scheduler expands `%NAME%` in a task's command, so a literal `%` would change it.
function refuseVariables(definition: ServiceDefinition): void {
  const texts = [definition.program, definition.workingFolder, ...definition.args];
  if (texts.some((text) => text.includes("%"))) {
    throw invalidServiceDefinition(definition.name, "has a % in its command or folder");
  }
}

// The XML goes into a new folder of its own and is gone once schtasks has read it.
async function register(
  schtasks: Schtasks,
  definition: ServiceDefinition,
  signal: AbortSignal,
): Promise<void> {
  const whoami = await program(schtasks, ["whoami", ...whoamiUserArgs], signal);
  const xml = renderTaskXml(definition, ownerSidOf(whoami.stdout));
  const folder = await mkdtemp(join(schtasks.temporaryFolder, "bnf-task-"));
  try {
    const file = join(folder, "task.xml");
    await writeFile(file, taskFileBytes(xml));
    const task = scheduledTaskName(definition.name);
    await program(schtasks, ["schtasks", "/Create", "/F", "/TN", task, "/XML", file], signal);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function install(
  schtasks: Schtasks,
  definition: ServiceDefinition,
  signal: AbortSignal,
): Promise<void> {
  checkServiceDefinition(definition, win32.isAbsolute);
  refuseVariables(definition);
  signal.throwIfAborted();
  const { name } = definition;
  await stopIfRunning(schtasks, name, signal);
  await register(schtasks, definition, signal);
  await program(schtasks, ["schtasks", "/Run", "/TN", scheduledTaskName(name)], signal);
  const until = schtasks.clock.now() + settleTimeoutMs;
  await waitFor(schtasks, { name, wanted: "running", until }, signal);
}

// Stops a task Task Scheduler holds, then runs `then`; one it does not hold is `not_installed`.
async function stopInstalled(
  schtasks: Schtasks,
  task: { readonly name: string; readonly signal: AbortSignal },
  then: () => Promise<void>,
): Promise<Result<void, "not_installed">> {
  const { name, signal } = task;
  checkServiceName(name);
  signal.throwIfAborted();
  if (!(await probe(schtasks, name, signal)).found) {
    return err("not_installed");
  }
  await stopIfRunning(schtasks, name, signal);
  await then();
  return ok(undefined);
}

// The task and its logon trigger stay, so it starts again at the next logon.
async function stop(
  schtasks: Schtasks,
  name: string,
  signal: AbortSignal,
): Promise<Result<void, "not_installed">> {
  return stopInstalled(schtasks, { name, signal }, async () => Promise.resolve());
}

async function uninstall(
  schtasks: Schtasks,
  name: string,
  signal: AbortSignal,
): Promise<Result<void, "not_installed">> {
  return stopInstalled(schtasks, { name, signal }, async () => {
    await program(schtasks, ["schtasks", "/Delete", "/F", "/TN", scheduledTaskName(name)], signal);
  });
}

async function status(
  schtasks: Schtasks,
  name: string,
  signal: AbortSignal,
): Promise<ServiceStatus> {
  checkServiceName(name);
  signal.throwIfAborted();
  const state = await probe(schtasks, name, signal);
  if (!state.found) {
    return { state: "not_installed" };
  }
  return {
    state: state.state === runningState ? "running" : "stopped",
    startsAtLogin: state.enabled && state.logon,
  };
}

/**
 * Services as scheduled tasks on Windows: `schtasks /Create /XML` registers a task that starts at
 * the owner's logon with their interactive token, so it runs only while they are logged on, where
 * Credential Manager answers. Install starts it with `schtasks /Run` and waits up to 10 s for it to
 * run; a stop ends it with `schtasks /End` and keeps the task. Task Scheduler keeps no output of
 * the program, which writes its own log.
 */
export function createSchtasksServiceManager(
  options: SchtasksServiceManagerOptions,
): ServiceManager {
  const schtasks: Schtasks = {
    clock: options.clock,
    temporaryFolder: options.temporaryFolder ?? tmpdir(),
    run: options.run ?? runCommandToExit,
  };
  return {
    install: async (definition, signal) => install(schtasks, definition, signal),
    stop: async (name, signal) => stop(schtasks, name, signal),
    uninstall: async (name, signal) => uninstall(schtasks, name, signal),
    status: async (name, signal) => status(schtasks, name, signal),
  };
}
