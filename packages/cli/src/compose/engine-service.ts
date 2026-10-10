import { join } from "node:path";
import type { Platform, ServiceDefinition } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";

/**
 * The background service's name: the LaunchAgent `io.binference.engine`, the unit
 * `binference-engine.service` or the scheduled task `binference-engine`.
 */
export const engineServiceName = "engine";

/** What one install of the service runs with besides the host. */
export interface EngineServiceOptions {
  /** This run's `--set` flags, which the service's own runs keep. */
  readonly sets: readonly string[];
  /** The config's `engine.shutdownBudgetMs`. */
  readonly shutdownBudgetMs: number;
}

// launchd, systemd and Task Scheduler each wait at most this long for a program to exit.
const maxStopTimeoutMs = 120_000;
// Time for the process to end once its shutdown sequence has.
const exitMarginMs = 5_000;

/** Where the OS appends the background service's own output: `logs/service.log`. */
export function serviceLogFile(platform: Platform): string {
  return join(platform.stateFolder.logs, "service.log");
}

/**
 * The background service of the state folder: `binference start --foreground` with this run's
 * `--set` flags, run by the same Node, with the same Node options, from the state folder. The OS
 * waits the shutdown sequence's budget and a margin for it to exit, at most 120 seconds.
 */
export function engineServiceDefinition(
  host: Pick<CliHost, "entry">,
  platform: Platform,
  options: EngineServiceOptions,
): ServiceDefinition {
  const { entry } = host;
  const sets = options.sets.flatMap((set) => ["--set", set]);
  return {
    name: engineServiceName,
    description: "binference engine",
    program: entry.node,
    args: [...entry.nodeOptions, entry.script, "start", "--foreground", ...sets],
    workingFolder: platform.stateFolder.root,
    logFile: serviceLogFile(platform),
    stopTimeoutMs: Math.min(options.shutdownBudgetMs + exitMarginMs, maxStopTimeoutMs),
  };
}
