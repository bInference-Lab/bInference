import type { CrashTimes, KillPointTime } from "./crash-times.js";

/** How long a crash pass takes by the measured times, before it starts. */
export interface PartEstimate {
  readonly killPoints: number;
  /** One run at each kill point. */
  readonly perRunSeconds: number;
  /** What the pass takes whatever its runs: the suite's and its files' setup. */
  readonly fixedSeconds: number;
  readonly seconds: number;
  /** Files of the pass the measured times do not know, so the estimate leaves them out. */
  readonly unknownFiles: readonly string[];
}

/** A part over this takes longer than the crash job may run. */
export const partLimitMinutes = 120;

// Vitest matches -t against a test's suite names and its own name joined by spaces.
function isChosen(point: KillPointTime, pattern: RegExp | undefined): boolean {
  if (pattern === undefined) {
    return true;
  }
  return `${point.name} ${point.test}, run 1`.search(pattern) !== -1;
}

/**
 * Estimates a pass over `files` (paths from the repository root) at `runs` runs per kill point,
 * with Vitest's `-t` pattern, from the measured times.
 */
export function estimatePart(
  times: CrashTimes,
  files: readonly string[],
  run: { readonly runs: number; readonly pattern: RegExp | undefined },
): PartEstimate {
  const known = files.flatMap((file) => {
    const entry = times.files[file];
    return entry === undefined ? [] : [entry];
  });
  const points = known.flatMap(({ killPoints }) =>
    killPoints.filter((point) => isChosen(point, run.pattern)),
  );
  const perRunSeconds = points.reduce((sum, point) => sum + point.seconds, 0);
  const fixedSeconds =
    times.suiteSeconds + known.reduce((sum, entry) => sum + entry.setupSeconds, 0);
  return {
    killPoints: points.length,
    perRunSeconds,
    fixedSeconds,
    seconds: fixedSeconds + perRunSeconds * run.runs,
    unknownFiles: files.filter((file) => times.files[file] === undefined),
  };
}

/** The most runs per kill point that keep the part within the limit, zero when none does. */
export function runsThatFit(estimate: PartEstimate): number {
  const left = partLimitMinutes * 60 - estimate.fixedSeconds;
  return estimate.perRunSeconds === 0 ? 0 : Math.max(0, Math.floor(left / estimate.perRunSeconds));
}

/** Whole minutes, rounded up, for the messages. */
export function minutesOf(seconds: number): number {
  return Math.ceil(seconds / 60);
}
