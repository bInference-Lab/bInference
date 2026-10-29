import { appendFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Reporter, TestCase, TestModule, TestSpecification, Vitest } from "vitest/node";
import { estimatePart, minutesOf, partLimitMinutes, runsThatFit } from "./crash-estimate.js";
import { type CrashRecord, crashResultsFolder } from "./crash-record.js";
import { type CrashTimes, crashTimesFile, readCrashTimes } from "./crash-times.js";
import { runsPerPoint } from "./runs-per-point.js";

const runName = /^(.*), run (\d+)$/;

function pathFrom(root: string, moduleId: string): string {
  return relative(root, moduleId).replaceAll("\\", "/");
}

function errorOf(testCase: TestCase): string | null {
  const [first] = testCase.result().errors ?? [];
  return first === undefined ? null : (first.message.split("\n")[0] ?? "").slice(0, 500);
}

function runOf(testCase: TestCase, root: string): CrashRecord {
  const [, test = testCase.name, run] = runName.exec(testCase.name) ?? [];
  return {
    kind: "run",
    at: new Date().toISOString(),
    file: pathFrom(root, testCase.module.moduleId),
    killPoint: testCase.parent.type === "suite" ? testCase.parent.fullName : "",
    test,
    run: run === undefined ? null : Number(run),
    state: testCase.result().state,
    seconds: (testCase.diagnostic()?.duration ?? 0) / 1000,
    error: errorOf(testCase),
  };
}

// Sizes the pass from the measured times and refuses one over the limit, before anvil starts.
function startPass(vitest: Vitest, files: readonly string[], times: CrashTimes): CrashRecord {
  const runs = runsPerPoint(process.env["BINFERENCE_CRASH_RUNS"]);
  const pattern = vitest.config.testNamePattern;
  const estimate = estimatePart(times, files, { runs, pattern });
  const part =
    process.env["BINFERENCE_CRASH_PART"] ??
    [files.join(" "), ...(pattern === undefined ? [] : [`-t ${pattern.source}`])].join(" ");
  if (estimate.seconds > partLimitMinutes * 60) {
    const fit = runsThatFit(estimate);
    const split = "the part into fewer kill points with -t";
    throw new Error(
      `Crash suite: the part "${part}" would take about ${String(minutesOf(estimate.seconds))} ` +
        `minutes (${String(runs)} runs at each of ${String(estimate.killPoints)} kill points), ` +
        `over the ${String(partLimitMinutes)} minutes a part may take. ` +
        (fit > 0
          ? `Set BINFERENCE_CRASH_RUNS to ${String(fit)} or fewer, or split ${split}.`
          : `Split ${split}.`),
    );
  }
  for (const file of estimate.unknownFiles) {
    vitest.logger.log(
      `Crash suite: ${crashTimesFile} has no times for ${file}, so the estimate leaves it out.`,
    );
  }
  vitest.logger.log(
    `Crash suite: runs per kill point: ${String(runs)}, kill points: ` +
      `${String(estimate.killPoints)}, about ${String(minutesOf(estimate.seconds))} min ` +
      `by ${crashTimesFile}.`,
  );
  return {
    kind: "start",
    at: new Date().toISOString(),
    part,
    runs,
    files,
    killPoints: estimate.killPoints,
    estimateSeconds: Math.round(estimate.seconds),
  };
}

// Names each kill point of a collected file that the measured times do not know yet.
function warnUnknown(vitest: Vitest, testModule: TestModule, times: CrashTimes): void {
  const file = pathFrom(vitest.config.root, testModule.moduleId);
  const entry = times.files[file];
  // A file without any times was named at the start already.
  if (entry === undefined) {
    return;
  }
  const known = new Set(entry.killPoints.map(({ name }) => name));
  const points = new Set(
    [...testModule.children.allTests()]
      .filter((testCase) => runName.test(testCase.name) && testCase.parent.type === "suite")
      .map((testCase) => (testCase.parent.type === "suite" ? testCase.parent.fullName : "")),
  );
  for (const point of [...points].filter((name) => !known.has(name))) {
    vitest.logger.log(
      `Crash suite: ${crashTimesFile} has no time for "${point}" in ${file}; ` +
        "pnpm crash:times adds it from this pass's results.",
    );
  }
}

function append(resultsFile: string, record: CrashRecord): void {
  appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
}

/** A pass under way: where its results go and when it started. */
interface OpenPass {
  readonly resultsFile: string;
  /** The results file from the repository root, as the messages name it. */
  readonly shown: string;
  readonly startedMs: number;
}

function openPass(
  vitest: Vitest,
  specifications: readonly TestSpecification[],
  times: CrashTimes,
): OpenPass {
  const { root } = vitest.config;
  const files = specifications.map(({ moduleId }) => pathFrom(root, moduleId));
  const start = startPass(vitest, files, times);
  mkdirSync(join(root, crashResultsFolder), { recursive: true });
  const shown = `${crashResultsFolder}/${start.at.replaceAll(":", "-")}.jsonl`;
  const resultsFile = join(root, shown);
  append(resultsFile, start);
  vitest.logger.log(`Crash suite: each run's result goes to ${shown} as it ends.`);
  return { resultsFile, shown, startedMs: Date.now() };
}

function secondsSince(startMs: number): number {
  return (Date.now() - startMs) / 1000;
}

function fileEndOf(testModule: TestModule, root: string, startMs: number): CrashRecord {
  const at = new Date().toISOString();
  return {
    kind: "file",
    at,
    file: pathFrom(root, testModule.moduleId),
    seconds: secondsSince(startMs),
  };
}

/**
 * The crash suite's reporter. Before the pass it prints the runs per kill point, the kill points
 * and the estimated time, and refuses a part over the limit. It appends each test's result to a
 * JSON-lines file in `reports/crash/` as the test ends, so a pass stopped from outside keeps
 * every finished run, and prints that file's path at the start and the end.
 */
export function createCrashReporter(): Reporter {
  let vitest: Vitest | undefined;
  let times: CrashTimes | undefined;
  let pass: OpenPass | undefined;
  const queuedMs = new Map<string, number>();
  const root = (): string => vitest?.config.root ?? "";
  return {
    onInit(context: Vitest) {
      vitest = context;
      times = readCrashTimes(context.config.root);
    },
    onTestRunStart(specifications: readonly TestSpecification[]) {
      if (vitest !== undefined && times !== undefined) {
        pass = openPass(vitest, specifications, times);
      }
    },
    onTestModuleCollected(testModule: TestModule) {
      if (vitest !== undefined && times !== undefined) {
        warnUnknown(vitest, testModule, times);
      }
    },
    onTestModuleQueued(testModule: TestModule) {
      queuedMs.set(testModule.moduleId, Date.now());
    },
    onTestCaseResult(testCase: TestCase) {
      // A test -t leaves out ends skipped; only the runs that ran are results.
      if (pass !== undefined && testCase.result().state !== "skipped") {
        append(pass.resultsFile, runOf(testCase, root()));
      }
    },
    onTestModuleEnd(testModule: TestModule) {
      if (pass !== undefined) {
        const startMs = queuedMs.get(testModule.moduleId) ?? pass.startedMs;
        append(pass.resultsFile, fileEndOf(testModule, root(), startMs));
      }
    },
    onTestRunEnd(_modules, _errors, reason) {
      if (pass !== undefined) {
        const at = new Date().toISOString();
        append(pass.resultsFile, {
          kind: "end",
          at,
          reason,
          seconds: secondsSince(pass.startedMs),
        });
        vitest?.logger.log(`Crash suite: the results are in ${pass.shown}.`);
      }
    },
  };
}
