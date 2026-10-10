import { BinferenceError, createDeadline } from "@binference/core";
import {
  acquireFileLock,
  ensurePrivateFolder,
  type Platform,
  type ServiceManager,
  type ServiceStatus,
} from "@binference/platform";
import type { ResultOf } from "@binference/protocol";
import { engineEndpoint, engineLogFile, platformOf } from "../compose/engine-locations.js";
import {
  engineServiceDefinition,
  engineServiceName,
  serviceLogFile,
} from "../compose/engine-service.js";
import { loadConfig } from "../config/load-config.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { systemDefaults } from "../program/system-defaults.js";
import { refuseConfig } from "./config-refusal.js";
import { engineAnswer, waitForEngine } from "./wait-for-engine.js";

type EngineStatus = ResultOf<"engine/status">;

/** One run of a service command: the host, its output, this OS's platform and service manager. */
export interface ServiceRun {
  readonly host: CliHost;
  readonly output: CliOutput;
  readonly platform: Platform;
  readonly manager: ServiceManager;
  readonly signal: AbortSignal;
}

// The engine's own start budget is 60 s; the OS takes a few more to run it.
const answerBudgetMs = 90_000;
// Installing waits up to 10 s for the OS, then the engine gets its answer budget.
const serviceStartBudgetMs = answerBudgetMs + 30_000;

/**
 * Whether an engine holds the state folder's lock: one serves it, or is starting on it. A lock file
 * this run cannot open, such as one in a folder that does not exist, is held by no engine.
 */
export function isEngineRunning(platform: Platform): boolean {
  try {
    const lock = acquireFileLock(platform.stateFolder.engineLock);
    if (lock.ok) {
      lock.value.release();
    }
    return !lock.ok;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "platform.lock_failed") {
      return false;
    }
    throw error;
  }
}

/** The service as the OS reports it, or `undefined` where no service manager answers. */
export async function serviceStatusOf(run: ServiceRun): Promise<ServiceStatus | undefined> {
  try {
    return await run.manager.status(engineServiceName, run.signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "platform.service_failed") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Whether the background service is out of reach of this run: it runs on the state folder in the
 * owner's home folder, so a run with `BINFERENCE_HOME` set never touches it.
 */
export function isHomeMoved(host: CliHost): boolean {
  return (host.env["BINFERENCE_HOME"] ?? "") !== "";
}

function announce(run: ServiceRun, status: EngineStatus): void {
  const { output, platform } = run;
  const places = {
    ipc: engineEndpoint(platform).address,
    logFile: engineLogFile(platform),
    serviceLog: serviceLogFile(platform),
  };
  output.say("service.started", places);
  if (status.state === "starting") {
    output.say("service.stillStarting");
  }
  if (status.state === "locked") {
    output.say("status.locked");
  }
  output.json({ service: "running", state: status.state, ...places });
}

// An engine runs already: the service's is left as it is, one in a terminal is in the way.
async function answerRunning(run: ServiceRun): Promise<ExitCode> {
  const { output, platform } = run;
  if ((await serviceStatusOf(run))?.state === "running") {
    output.say("service.alreadyRunning");
    output.json({ service: "running" });
    return 0;
  }
  output.fail({
    code: "engine.already_running",
    key: "start.alreadyRunning",
    values: { folder: platform.stateFolder.root },
  });
  return 1;
}

// Installs the service and waits for its engine; one that never answers is stopped again.
async function install(run: ServiceRun, sets: readonly string[], budgetMs: number) {
  const { host, output, platform, manager, signal } = run;
  const files = { permissions: platform.permissions, signal };
  await ensurePrivateFolder(platform.stateFolder.logs, files);
  const options = { sets, shutdownBudgetMs: budgetMs };
  const serviceLog = serviceLogFile(platform);
  try {
    await manager.install(engineServiceDefinition(host, platform, options), signal);
  } catch (error) {
    const code = error instanceof BinferenceError ? error.code : "unexpected";
    output.fail({ code: "service.failed", key: "service.failed", values: { code, serviceLog } });
    return 1;
  }
  const wait = { clock: host.clock, budgetMs: answerBudgetMs, signal };
  const status = await waitForEngine(async (asking) => engineAnswer(host, asking), wait);
  if (status === undefined) {
    await manager.stop(engineServiceName, signal);
    const seconds = String(answerBudgetMs / 1000);
    output.fail({
      code: "service.no_answer",
      key: "service.silent",
      values: { seconds, serviceLog },
    });
    return 1;
  }
  announce(run, status);
  return 0;
}

/**
 * `binference start`: installs the background service, which runs `binference start
 * --foreground` at every login and after a crash, starts it, and waits until the engine answers
 * past `starting`, then names its IPC address and its two logs. The config is checked first, so a
 * problem shows here rather than in the service's log. A service that runs already is left as it
 * is; an engine in a terminal is refused, as is a run with `BINFERENCE_HOME` set, since the
 * service runs on the state folder in the owner's home folder.
 */
export async function runServiceStart(
  host: CliHost,
  output: CliOutput,
  sets: readonly string[],
): Promise<ExitCode> {
  const platform = platformOf(host);
  if (isHomeMoved(host)) {
    const folder = platform.stateFolder.root;
    output.fail({ code: "service.home_moved", key: "service.homeMoved", values: { folder } });
    return 1;
  }
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: serviceStartBudgetMs,
  });
  const { signal } = deadline;
  try {
    const system = systemDefaults(host.env, platform);
    const file = platform.stateFolder.configFile;
    const loaded = await loadConfig({ file, env: host.env, sets, system, signal });
    if (!loaded.ok) {
      refuseConfig(output, loaded.issues);
      return 1;
    }
    // The host's service manager, such as a test's, or this OS's own.
    const manager = host.serviceManager ?? platform.serviceManager(host.clock);
    const run = { host, output, platform, manager, signal };
    return isEngineRunning(platform)
      ? await answerRunning(run)
      : await install(run, sets, loaded.config.engine.shutdownBudgetMs);
  } finally {
    deadline.clear();
  }
}
