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

/** Where the measured times live, from the repository root; `pnpm crash:times` writes it. */
export const crashTimesFile = "config/vitest/crash-times.generated.json";

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

/** Reads the measured times from the repository at `root`. */
export function readCrashTimes(root: string): CrashTimes {
  const text = readFileSync(join(root, crashTimesFile), "utf8");
  return crashTimesSchema.parse(JSON.parse(text));
}
