import { mkdir, rm, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { err, ok, type Clock, type Result } from "@binference/core";
import type { FilePermissions, ServiceManager } from "../ports.js";
import { writePrivateFile } from "../private-files.js";
import { runCommandToExit, type ProgramExit, type RunToExit } from "../run-command.js";
import { pollUntil } from "../service/poll-until.js";
import {
  checkServiceDefinition,
  checkServiceName,
  type ServiceDefinition,
  type ServiceStatus,
} from "../service/service-definition.js";
import { serviceFailed } from "../service/service-failed.js";
import { launchdLabel, renderLaunchdPlist } from "./launchd-plist.js";
import { createPosixFilePermissions } from "./posix-file-permissions.js";

/** Where the macOS adapter keeps its plists, and what it runs `launchctl` with. */
export interface LaunchdServiceManagerOptions {
  readonly clock: Clock;
  /** `~/Library/LaunchAgents`, where launchd looks at every login. */
  readonly agentsFolder: string;
  /** The owner's user id: the services live in the domain `gui/<uid>`, their desktop session. */
  readonly uid: number;
  /** `runCommandToExit` when left out; tests pass a recorder. */
  readonly run?: RunToExit;
  /** POSIX modes when left out. */
  readonly permissions?: FilePermissions;
}

interface Launchd {
  readonly clock: Clock;
  readonly agentsFolder: string;
  readonly domain: string;
  readonly run: RunToExit;
  readonly permissions: FilePermissions;
}

type JobState = "absent" | "running" | "stopped";

interface Wait {
  readonly name: string;
  readonly wanted: JobState;
  readonly until: number;
}

const startTimeoutMs = 10_000;
// launchd kills a job once its ExitTimeOut, at most 120 s, has passed.
const unloadTimeoutMs = 130_000;

// launchctl answers 113 for a job it does not hold; bootout can answer 3, "No such process".
function isAbsent(exit: ProgramExit): boolean {
  return exit.exitCode === 113 || exit.exitCode === 3;
}

async function hasFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const targetOf = (launchd: Launchd, name: string): string =>
  `${launchd.domain}/${launchdLabel(name)}`;

const plistOf = (launchd: Launchd, name: string): string =>
  join(launchd.agentsFolder, `${launchdLabel(name)}.plist`);

async function launchctl(
  launchd: Launchd,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ProgramExit> {
  const exit = await launchd.run("launchctl", args, signal);
  if (exit.exitCode !== 0 && !isAbsent(exit)) {
    throw serviceFailed(`launchctl ${args.join(" ")} failed.`, exit);
  }
  return exit;
}

async function readJob(launchd: Launchd, name: string, signal: AbortSignal): Promise<JobState> {
  const exit = await launchctl(launchd, ["print", targetOf(launchd, name)], signal);
  if (isAbsent(exit)) {
    return "absent";
  }
  return /^\tstate = running$/m.test(exit.stdout) ? "running" : "stopped";
}

async function waitFor(launchd: Launchd, wait: Wait, signal: AbortSignal): Promise<void> {
  const label = launchdLabel(wait.name);
  await pollUntil(
    launchd.clock,
    {
      isDone: async () => (await readJob(launchd, wait.name, signal)) === wait.wanted,
      until: wait.until,
      failure: () =>
        serviceFailed(
          wait.wanted === "running"
            ? `launchd loaded ${label} but it does not run; read its log file.`
            : `launchd still holds ${label} after its stop timeout.`,
        ),
    },
    signal,
  );
}

// An override from `launchctl disable` would keep the job from loading at login.
async function isDisabled(launchd: Launchd, name: string, signal: AbortSignal): Promise<boolean> {
  const exit = await launchctl(launchd, ["print-disabled", launchd.domain], signal);
  const label = `"${launchdLabel(name)}"`;
  return exit.stdout
    .split("\n")
    .some((line) => [`${label} => disabled`, `${label} => true`].includes(line.trim()));
}

async function unload(launchd: Launchd, name: string, signal: AbortSignal): Promise<void> {
  await launchctl(launchd, ["bootout", targetOf(launchd, name)], signal);
  const until = launchd.clock.now() + unloadTimeoutMs;
  await waitFor(launchd, { name, wanted: "absent", until }, signal);
}

async function install(
  launchd: Launchd,
  definition: ServiceDefinition,
  signal: AbortSignal,
): Promise<void> {
  checkServiceDefinition(definition, posix.isAbsolute);
  signal.throwIfAborted();
  const { name } = definition;
  if ((await readJob(launchd, name, signal)) !== "absent") {
    await unload(launchd, name, signal);
  }
  await mkdir(launchd.agentsFolder, { recursive: true });
  const files = { permissions: launchd.permissions, signal };
  await writePrivateFile(plistOf(launchd, name), renderLaunchdPlist(definition), files);
  if (await isDisabled(launchd, name, signal)) {
    await launchctl(launchd, ["enable", targetOf(launchd, name)], signal);
  }
  const args = ["bootstrap", launchd.domain, plistOf(launchd, name)];
  const exit = await launchd.run("launchctl", args, signal);
  if (exit.exitCode !== 0) {
    throw serviceFailed(
      `launchctl bootstrap refused ${launchdLabel(name)}; it needs this user's desktop ` +
        "session, so run it on a logged-in Mac, not over SSH.",
      exit,
    );
  }
  const until = launchd.clock.now() + startTimeoutMs;
  await waitFor(launchd, { name, wanted: "running", until }, signal);
}

async function uninstall(
  launchd: Launchd,
  name: string,
  signal: AbortSignal,
): Promise<Result<void, "not_installed">> {
  checkServiceName(name);
  signal.throwIfAborted();
  const job = await readJob(launchd, name, signal);
  if (job === "absent" && !(await hasFile(plistOf(launchd, name)))) {
    return err("not_installed");
  }
  if (job !== "absent") {
    await unload(launchd, name, signal);
  }
  await rm(plistOf(launchd, name), { force: true });
  return ok(undefined);
}

async function status(launchd: Launchd, name: string, signal: AbortSignal): Promise<ServiceStatus> {
  checkServiceName(name);
  signal.throwIfAborted();
  const job = await readJob(launchd, name, signal);
  const hasPlist = await hasFile(plistOf(launchd, name));
  if (job === "absent" && !hasPlist) {
    return { state: "not_installed" };
  }
  return {
    state: job === "running" ? "running" : "stopped",
    startsAtLogin: hasPlist && !(await isDisabled(launchd, name, signal)),
  };
}

/**
 * Services as LaunchAgents on macOS: a plist in `~/Library/LaunchAgents`, loaded with
 * `launchctl bootstrap` into the owner's desktop session, so launchd starts it at every login.
 * Install waits up to 10 s for the job to run; removal waits until launchd has let it go.
 */
export function createLaunchdServiceManager(options: LaunchdServiceManagerOptions): ServiceManager {
  const launchd: Launchd = {
    clock: options.clock,
    agentsFolder: options.agentsFolder,
    domain: `gui/${String(options.uid)}`,
    run: options.run ?? runCommandToExit,
    permissions: options.permissions ?? createPosixFilePermissions(),
  };
  return {
    install: async (definition, signal) => install(launchd, definition, signal),
    uninstall: async (name, signal) => uninstall(launchd, name, signal),
    status: async (name, signal) => status(launchd, name, signal),
  };
}
