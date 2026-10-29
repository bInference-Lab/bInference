import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import {
  type CrashRecord,
  type CrashRunResult,
  crashRecordSchema,
} from "../config/vitest/crash-record.js";
import {
  type CrashTimes,
  crashTimesFile,
  type FileTimes,
  type KillPointTime,
  readCrashTimes,
} from "../config/vitest/crash-times.js";

const usage =
  "Usage: pnpm crash:times <results.jsonl>..., the files a crash pass wrote to reports/crash/.";

/** What one results file measured. */
interface Pass {
  readonly runs: readonly CrashRunResult[];
  /** Each file's setup: its wall time less its runs. */
  readonly setups: ReadonlyMap<string, number>;
  /** The pass's own setup, when it ended: its wall time less its files'. */
  readonly suite: number | undefined;
}

function readRecords(path: string): readonly CrashRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line, index) => {
      if (line.trim().length === 0) {
        return [];
      }
      const parsed = crashRecordSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(
          `${path}:${String(index + 1)} is not a crash result: ${parsed.error.message}`,
        );
      }
      return [parsed.data];
    });
}

function passOf(records: readonly CrashRecord[]): Pass {
  const runs = records.flatMap((record) =>
    record.kind === "run" && record.run !== null ? [record] : [],
  );
  const files = records.flatMap((record) => (record.kind === "file" ? [record] : []));
  const end = records.find((record) => record.kind === "end");
  const runSeconds = (file: string): number =>
    runs.filter((run) => run.file === file).reduce((sum, run) => sum + run.seconds, 0);
  const fileSeconds = files.reduce((sum, file) => sum + file.seconds, 0);
  return {
    runs,
    setups: new Map(
      files.map((file) => [file.file, Math.max(0, file.seconds - runSeconds(file.file))]),
    ),
    suite: end === undefined ? undefined : Math.max(0, end.seconds - fileSeconds),
  };
}

function mean(values: readonly number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

// A kill point's time is the mean of its passed runs: a failed run may end early or time out.
function killPointsOf(passes: readonly Pass[], file: string): readonly KillPointTime[] {
  const runs = passes.flatMap((pass) =>
    pass.runs.filter((run) => run.file === file && run.state === "passed"),
  );
  const names = [...new Set(runs.map((run) => run.killPoint))];
  return names.map((name) => {
    const own = runs.filter((run) => run.killPoint === name);
    return { name, test: own[0]?.test ?? "", seconds: mean(own.map((run) => run.seconds)) };
  });
}

function merged(old: FileTimes | undefined, measured: FileTimes): FileTimes {
  const fresh = new Set(measured.killPoints.map(({ name }) => name));
  const kept = (old?.killPoints ?? []).filter(({ name }) => !fresh.has(name));
  return {
    setupSeconds: measured.setupSeconds,
    killPoints: [...kept, ...measured.killPoints].toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

function timesOf(old: CrashTimes, passes: readonly Pass[]): CrashTimes {
  const files = [...new Set(passes.flatMap((pass) => [...pass.setups.keys()]))];
  const measured = files.map((file): [string, FileTimes] => {
    const setups = passes.flatMap((pass) => pass.setups.get(file) ?? []);
    const killPoints = killPointsOf(passes, file);
    return [file, merged(old.files[file], { setupSeconds: mean(setups), killPoints })];
  });
  const suites = passes.flatMap((pass) => pass.suite ?? []);
  return {
    suiteSeconds: suites.length === 0 ? old.suiteSeconds : mean(suites),
    files: Object.fromEntries(
      [
        ...Object.entries(old.files).filter(([file]) => !files.includes(file)),
        ...measured,
      ].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

const root = process.cwd();
const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error(`crash:times: ${usage}`);
  process.exit(2);
}
const passes = paths.map((path) => passOf(readRecords(path)));
const times = timesOf(readCrashTimes(root), passes);
writeFileSync(crashTimesFile, `${JSON.stringify(times, null, 2)}\n`);
const points = Object.values(times.files).reduce((sum, file) => sum + file.killPoints.length, 0);
console.log(
  `crash:times: ${crashTimesFile} holds ${String(points)} kill points of ` +
    `${String(Object.keys(times.files).length)} files, from ${String(passes.length)} passes.`,
);
