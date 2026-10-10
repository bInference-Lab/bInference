import { BinferenceError, createDeadline } from "@binference/core";
import { pollUntil } from "@binference/platform";
import { platformOf } from "../compose/engine-locations.js";
import { engineServiceName } from "../compose/engine-service.js";
import type { StartFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { connectEngine } from "./connect-engine.js";
import {
  isEngineRunning,
  isHomeMoved,
  runServiceStart,
  type ServiceRun,
  serviceStatusOf,
} from "./service-start-command.js";

/** How a stop ended. */
type StopOutcome =
  | { readonly kind: "stopped"; readonly isServiceKept: boolean }
  | { readonly kind: "not_running" }
  | { readonly kind: "late" };

// The OS waits at most 120 s for a program to exit; the lock goes a moment after.
const stopBudgetMs = 130_000;

// The engine's own shutdown sequence, asked over IPC. The sequence closes the server that answers,
// so the reply may lose the race to the connection's end.
async function askToStop(host: CliHost, signal: AbortSignal): Promise<void> {
  const connection = await connectEngine(host, signal);
  if (!connection.ok) {
    return;
  }
  try {
    await connection.client.call("engine/stop", {}, { signal }).catch(() => ({}));
  } finally {
    connection.client.close();
  }
}

// Whether the engine let go of the state folder before the stop's time ran out.
async function hasLetGo(run: ServiceRun): Promise<boolean> {
  const late = new BinferenceError({ code: "stop.late", message: "The engine still runs." });
  const { host, platform, signal } = run;
  const poll = {
    isDone: async () => Promise.resolve(!isEngineRunning(platform)),
    until: host.clock.now() + stopBudgetMs,
    failure: () => late,
  };
  try {
    await pollUntil(host.clock, poll, signal);
    return true;
  } catch (error) {
    if (error !== late) {
      throw error;
    }
    return false;
  }
}

// The engine stops through its own shutdown sequence on every OS, Windows too, where the OS ends a
// task without a signal Node hears. Then the OS stops the service, which keeps it for the next
// login; that also ends an engine that did not take the request, such as one still starting.
async function stopEngine(run: ServiceRun): Promise<StopOutcome> {
  const { host, manager, signal } = run;
  const wasRunning = isEngineRunning(run.platform);
  if (wasRunning) {
    await askToStop(host, signal);
  }
  const service = isHomeMoved(host) ? undefined : await serviceStatusOf(run);
  const isInstalled = service !== undefined && service.state !== "not_installed";
  if (isInstalled) {
    await manager.stop(engineServiceName, signal);
  }
  if (!wasRunning && service?.state !== "running") {
    return { kind: "not_running" };
  }
  return (await hasLetGo(run)) ? { kind: "stopped", isServiceKept: isInstalled } : { kind: "late" };
}

async function withStopRun(
  host: CliHost,
  output: CliOutput,
  use: (run: ServiceRun) => Promise<ExitCode>,
): Promise<ExitCode> {
  const platform = platformOf(host);
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: stopBudgetMs + 10_000,
  });
  const { signal } = deadline;
  try {
    // The host's service manager, such as a test's, or this OS's own.
    const manager = host.serviceManager ?? platform.serviceManager(host.clock);
    return await use({ host, output, platform, manager, signal });
  } finally {
    deadline.clear();
  }
}

function refuseLate(run: ServiceRun): ExitCode {
  const folder = run.platform.stateFolder.root;
  run.output.fail({ code: "engine.still_running", key: "stop.late", values: { folder } });
  return 1;
}

/**
 * `binference stop`: asks the engine for its shutdown sequence over IPC, then has the OS stop the
 * background service, which keeps it, so it starts again at the next login. Waits until the engine
 * lets go of the state folder. Exits 0 when nothing runs any more, 1 when the engine still runs.
 * With `BINFERENCE_HOME` set it stops only the engine of that folder, never the service.
 */
export async function runStop(host: CliHost, output: CliOutput): Promise<ExitCode> {
  return withStopRun(host, output, async (run) => {
    const outcome = await stopEngine(run);
    if (outcome.kind === "late") {
      return refuseLate(run);
    }
    if (outcome.kind === "not_running") {
      output.say("stop.notRunning");
      output.json({ state: "stopped" });
      return 0;
    }
    output.say(outcome.isServiceKept ? "stop.serviceKept" : "start.stopped");
    output.json({ state: "stopped", service: outcome.isServiceKept ? "stopped" : "none" });
    return 0;
  });
}

/**
 * `binference restart`: stops the engine as `binference stop` does, then starts the background
 * service as `binference start` does, with this run's `--set` flags.
 */
export async function runRestart(
  host: CliHost,
  output: CliOutput,
  flags: StartFlags,
): Promise<ExitCode> {
  if (isHomeMoved(host)) {
    return runServiceStart(host, output, flags.sets);
  }
  const stopped = await withStopRun(host, output, async (run) =>
    (await stopEngine(run)).kind === "late" ? refuseLate(run) : 0,
  );
  return stopped === 0 ? runServiceStart(host, output, flags.sets) : stopped;
}
