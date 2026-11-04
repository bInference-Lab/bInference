import { join } from "node:path";
import { z } from "zod";

/**
 * The owner's first day, step by step, as the first-day smoke times it; `cleanup` removes what a
 * day on Privy's dev app made there.
 */
type FirstDayStep =
  | "install"
  | "init"
  | "start"
  | "trade"
  | "status"
  | "update"
  | "uninstall"
  | "cleanup";

/** How one step ended: `refused` is a refusal the step expects, such as `update` on Windows. */
export interface StepResult {
  readonly step: FirstDayStep;
  readonly seconds: number;
  readonly outcome: "passed" | "refused" | "failed";
  /** What went wrong, one line each; empty unless it failed. */
  readonly problems: readonly string[];
}

/** One step to run: what it checks answers its problems, and `refused` when it was refused. */
export interface StepRun {
  readonly step: FirstDayStep;
  readonly run: () => Promise<readonly string[] | "refused">;
}

/** Each health signal `engine/status` names when every part of the engine is in place. */
export const engineParts: readonly string[] = [
  "event_loop",
  "memory",
  "logs",
  "executor",
  "custody",
  "rpc",
  "backup_key",
  "runtime",
  "watcher",
];

// A step's problems, or its refusal; a step that throws has its message as its one problem.
async function ranOf(run: StepRun["run"]): Promise<readonly string[] | "refused"> {
  try {
    return await run();
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function outcomeOf(ran: readonly string[] | "refused"): StepResult["outcome"] {
  if (ran === "refused") {
    return "refused";
  }
  return ran.length === 0 ? "passed" : "failed";
}

/**
 * Runs the steps in order, each timed in seconds to a tenth, and stops at the first that fails:
 * every later step needs it. `elapsed` reads the time in milliseconds.
 */
export async function runSteps(
  steps: readonly StepRun[],
  elapsed: () => number,
): Promise<readonly StepResult[]> {
  const results: StepResult[] = [];
  for (const { step, run } of steps) {
    const started = elapsed();
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    const ran = await ranOf(run);
    const seconds = Math.round((elapsed() - started) / 100) / 10;
    const outcome = outcomeOf(ran);
    results.push({ step, seconds, outcome, problems: ran === "refused" ? [] : ran });
    if (outcome === "failed") {
      break;
    }
  }
  return results;
}

/** Where the install script and binference keep their files under one home folder. */
export interface FirstDayPaths {
  readonly state: string;
  readonly data: string;
  readonly program: string;
  readonly node: string;
  readonly launcher: string;
  /** What the owner may have added to PATH: the line on macOS and Linux, the folder on Windows. */
  readonly pathText: string;
}

/** The paths the install script uses under `home` on `os`, as decision 0357 lays them out. */
export function firstDayPaths(home: string, os: string): FirstDayPaths {
  const windows = os === "win32";
  const data = windows
    ? join(home, "AppData", "Local", "binference")
    : join(home, ".local", "share", "binference");
  const bin = join(data, "bin");
  return {
    state: join(home, ".binference"),
    data,
    program: join(data, "npm"),
    node: join(data, "node"),
    launcher: join(bin, windows ? "binference.cmd" : "binference"),
    pathText: windows ? bin : `export PATH="${bin}:$PATH"`,
  };
}

/** What the one-liner run did: its exit code, its output, and the launcher it said it wrote. */
export interface OneLinerOutcome {
  readonly status: number;
  readonly output: string;
  readonly command?: string;
}

/** The install step's problems: the one-liner must end 0 and name the launcher at its place. */
export function installProblems(run: OneLinerOutcome, paths: FirstDayPaths): readonly string[] {
  return [
    ...(run.status === 0 ? [] : [`the one-liner ended with ${String(run.status)}`]),
    ...(run.command === paths.launcher
      ? []
      : [`the one-liner named the launcher ${run.command ?? "nowhere"}, not ${paths.launcher}`]),
    ...(run.output.includes(paths.pathText) ? [] : ["the one-liner printed no PATH line"]),
  ];
}

/** Where the repository's sources stand when the day runs: their commit, and any change to it. */
export interface SourcesState {
  readonly commit: string;
  /** Whether a tracked file differs from the commit. */
  readonly isChanged: boolean;
}

/**
 * The same-code check's problems: `start`, `update` and `uninstall` run from the sources, so the
 * sources must be the commit both releases were packed from, with no tracked change, and the
 * launcher must run the release the one-liner installed.
 */
export function sameCodeProblems(
  packedCommit: string,
  sources: SourcesState,
  launcher: { readonly printed: string; readonly version: string },
): readonly string[] {
  return [
    ...(sources.commit === packedCommit
      ? []
      : [`the releases were packed from ${packedCommit}, the sources are at ${sources.commit}`]),
    ...(sources.isChanged ? ["the sources hold changes their commit does not"] : []),
    ...(launcher.printed.includes(launcher.version)
      ? []
      : [`the launcher printed ${launcher.printed.trim()}, not ${launcher.version}`]),
  ];
}

const initSchema = z.looseObject({ pairing: z.object({ link: z.url() }) });

/** The start code of the pairing link `init --yes --json` printed, or its problem. */
export function pairingCodeOf(exitCode: number, lastLine: string): string | readonly string[] {
  if (exitCode !== 0) {
    return [`init --yes ended with ${String(exitCode)}`];
  }
  const parsed = initSchema.safeParse(JSON.parse(lastLine));
  const code = parsed.success
    ? new URL(parsed.data.pairing.link).searchParams.get("start")
    : undefined;
  return code ?? ["init --yes printed no pairing link"];
}

const statusSchema = z.looseObject({
  state: z.string(),
  version: z.string(),
  health: z.array(z.looseObject({ signal: z.string(), state: z.string() })),
});

/**
 * The status step's problems from `status --json`'s last line: the engine must be ready on
 * `version`, with every part's signal there and none failing. A part left out, a placeholder that
 * refuses, or a lock shows here.
 */
export function statusProblems(lastLine: string, version: string): readonly string[] {
  const parsed = statusSchema.safeParse(JSON.parse(lastLine));
  if (!parsed.success) {
    return ["status --json printed no engine status"];
  }
  const { state, health } = parsed.data;
  const shown = new Set(health.map((signal) => signal.signal));
  return [
    ...(state === "ready" ? [] : [`the engine is ${state}, not ready`]),
    ...(parsed.data.version === version ? [] : [`the engine runs ${parsed.data.version}`]),
    ...engineParts.filter((part) => !shown.has(part)).map((part) => `status shows no ${part}`),
    ...health.filter((signal) => signal.state === "fail").map((signal) => `${signal.signal} fails`),
  ];
}

/**
 * The update step's verdict from its exit code and words: on Windows `update` refuses with
 * `update.windows` (decision 0356), elsewhere it ends 0.
 */
export function updateVerdict(
  os: string,
  exitCode: number,
  output: string,
): readonly string[] | "refused" {
  if (os !== "win32") {
    return exitCode === 0 ? [] : [`update ended with ${String(exitCode)}`];
  }
  return exitCode === 1 && output.includes("update.windows")
    ? "refused"
    : [`update on Windows ended with ${String(exitCode)}, not its refusal`];
}

/** The uninstall step's problems from its exit code and words: it names the PATH entry to remove. */
export function uninstallProblems(
  exitCode: number,
  output: string,
  paths: FirstDayPaths,
): readonly string[] {
  return [
    ...(exitCode === 0 ? [] : [`uninstall ended with ${String(exitCode)}`]),
    ...(output.includes(paths.pathText) ? [] : ["uninstall named no PATH entry to remove"]),
  ];
}

/**
 * What uninstall left in the home folder, by name: `exists` answers whether a path is there, and
 * `serviceInstalled` whether the background service is still installed.
 */
export async function leftoversOf(
  paths: FirstDayPaths,
  checks: {
    readonly exists: (path: string) => Promise<boolean>;
    readonly serviceInstalled: boolean;
  },
): Promise<readonly string[]> {
  const named = [
    ["the state folder", paths.state],
    ["the program", paths.program],
    ["the pinned Node", paths.node],
    ["the launcher", paths.launcher],
    ["the data folder", paths.data],
  ] as const;
  const left = await Promise.all(named.map(async ([, path]) => checks.exists(path)));
  return [
    ...(checks.serviceInstalled ? ["the background service is still installed"] : []),
    ...named.filter((_, index) => left[index]).map(([name, path]) => `${name} stays at ${path}`),
  ];
}

/**
 * The service guard's problems from its log: each line is a call of the OS's own service manager
 * that a stand-in refused, which the smoke must never make.
 */
export function guardProblems(log: string): readonly string[] {
  return log
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => `the OS's service manager was called: ${line.trim()}`);
}
