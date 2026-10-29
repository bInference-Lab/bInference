import { z } from "zod";

/** The line a crash pass writes first: what it runs and how long the stored times say it takes. */
interface CrashPassStart {
  readonly kind: "start";
  readonly at: string;
  readonly part: string;
  readonly runs: number;
  readonly files: readonly string[];
  readonly killPoints: number;
  readonly estimateSeconds: number;
}

/** One test of a crash file, written as it ends. A kill point's runs carry their run number. */
export interface CrashRunResult {
  readonly kind: "run";
  readonly at: string;
  readonly file: string;
  /** The kill point: the full name of the test's suite, empty for a test outside any suite. */
  readonly killPoint: string;
  /** The test's name without its run number. */
  readonly test: string;
  readonly run: number | null;
  readonly state: "passed" | "failed" | "skipped" | "pending";
  readonly seconds: number;
  /** The first line of the first error of a failed run. */
  readonly error: string | null;
}

/** A crash file's wall time, written as the file ends: its runs, setup and teardown together. */
interface CrashFileEnd {
  readonly kind: "file";
  readonly at: string;
  readonly file: string;
  readonly seconds: number;
}

/** The line a crash pass writes last, when Vitest ends it; a pass stopped from outside has none. */
interface CrashPassEnd {
  readonly kind: "end";
  readonly at: string;
  readonly reason: "passed" | "failed" | "interrupted";
  readonly seconds: number;
}

/** One line of a crash results file. */
export type CrashRecord = CrashPassStart | CrashRunResult | CrashFileEnd | CrashPassEnd;

/** The folder each crash pass writes its results file into, from the repository root. */
export const crashResultsFolder = "reports/crash";

/** Parses one line of a crash results file. */
export const crashRecordSchema: z.ZodType<CrashRecord> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
    at: z.string(),
    part: z.string(),
    runs: z.number().int().positive(),
    files: z.array(z.string()).readonly(),
    killPoints: z.number().int().nonnegative(),
    estimateSeconds: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("run"),
    at: z.string(),
    file: z.string(),
    killPoint: z.string(),
    test: z.string(),
    run: z.number().int().positive().nullable(),
    state: z.enum(["passed", "failed", "skipped", "pending"]),
    seconds: z.number().nonnegative(),
    error: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("file"),
    at: z.string(),
    file: z.string(),
    seconds: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("end"),
    at: z.string(),
    reason: z.enum(["passed", "failed", "interrupted"]),
    seconds: z.number().nonnegative(),
  }),
]);
