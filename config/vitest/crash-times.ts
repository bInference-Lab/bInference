import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** One kill point's measured time: the mean wall time of one of its runs. */
export interface KillPointTime {
  /** The kill point: the full name of its suite, as Vitest reports it. */
  readonly name: string;
  /** Its test's name without the run number, which a `-t` pattern also reads. */
  readonly test: string;
  readonly seconds: number;
}

/** A crash file's measured times. */
export interface FileTimes {
  /** What the file takes beside its kill points' runs: imports, hooks and its other tests. */
  readonly setupSeconds: number;
  readonly killPoints: readonly KillPointTime[];
}

/** The crash suite's measured times, which size a pass before it starts. */
export interface CrashTimes {
  /** What a pass takes beside its files: Vitest's start, anvil's start and its stop. */
  readonly suiteSeconds: number;
  /** Each crash file's times, by its path from the repository root. */
  readonly files: Readonly<Record<string, FileTimes>>;
}

// Each machine the times are measured on, and its file from the repository root: the maintainers'
// laptop, and the hosted macOS runner of the nightly job, where a run takes 1.1 to 4.8 times as
// long as on the laptop, by kill point.
const timesFiles: ReadonlyMap<string, string> = new Map([
  ["laptop", "config/vitest/crash-times.generated.json"],
  ["macos-runner", "config/vitest/crash-times.macos-runner.generated.json"],
]);

/**
 * Where the measured times of the machine `BINFERENCE_CRASH_TIMES` names live, from the
 * repository root: the laptop's when it is unset. `pnpm crash:times` writes the same file. Throws
 * on a name with no times file.
 */
export function crashTimesFileOf(machine: string | undefined): string {
  const file = timesFiles.get(machine ?? "laptop");
  if (file === undefined) {
    const names = [...timesFiles.keys()].join(", ");
    throw new Error(`BINFERENCE_CRASH_TIMES is ${String(machine)}; it takes one of ${names}.`);
  }
  return file;
}

const seconds = z.number().nonnegative();

/** Parses the measured times file. */
const crashTimesSchema: z.ZodType<CrashTimes> = z.object({
  suiteSeconds: seconds,
  files: z.record(
    z.string(),
    z.object({
      setupSeconds: seconds,
      killPoints: z.array(z.object({ name: z.string(), test: z.string(), seconds })).readonly(),
    }),
  ),
});

/** Reads the measured times in `file`, a path from the repository at `root`. */
export function readCrashTimes(root: string, file: string): CrashTimes {
  const text = readFileSync(join(root, file), "utf8");
  return crashTimesSchema.parse(JSON.parse(text));
}
