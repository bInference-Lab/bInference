import type { CommandRun } from "../program/command-run.js";
import {
  isEngineRunning,
  isHomeMoved,
  runServiceStart,
  type ServiceRun,
  serviceStatusOf,
} from "./service-start-command.js";
import { type ForegroundStart, startForeground } from "./start-command.js";
import { stopEngine, withStopRun } from "./stop-command.js";

/** How the engine ran before a command stopped it to change the state folder, and so how it starts after. */
export type EngineRun = "service" | "foreground" | "stopped";

async function howItRuns(run: ServiceRun): Promise<EngineRun> {
  if (!isHomeMoved(run.host) && (await serviceStatusOf(run))?.state === "running") {
    return "service";
  }
  return isEngineRunning(run.platform) ? "foreground" : "stopped";
}

/**
 * Stops the engine as `binference stop` does and answers how it ran; `undefined` when it still
 * runs once the stop's time is up.
 */
export async function stopFor(run: CommandRun): Promise<EngineRun | undefined> {
  const how: { ran: EngineRun | undefined } = { ran: undefined };
  await withStopRun(run.host, run.output, async (stopping) => {
    const ran = await howItRuns(stopping);
    const isLate = ran !== "stopped" && (await stopEngine(stopping)).kind === "late";
    how.ran = isLate ? undefined : ran;
    return 0;
  });
  return how.ran;
}

/**
 * Starts the engine as it ran, with the `--set` flags given: the background service again, or in
 * this terminal for an engine that ran in the foreground, whose `serve` then runs it until a stop.
 */
export async function startAs(
  run: CommandRun,
  sets: readonly string[],
  ran: Exclude<EngineRun, "stopped">,
): Promise<ForegroundStart> {
  const { host, output } = run;
  if (ran === "foreground") {
    return startForeground(host, output, sets);
  }
  const code = await runServiceStart(host, output, sets);
  return code === 0
    ? { isStarted: true, serve: async () => Promise.resolve(0) }
    : { isStarted: false, code };
}
