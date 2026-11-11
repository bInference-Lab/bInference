import type { ShellAskReason } from "@binference/protocol";
import type { CommandLine } from "./command-line.js";
import type { LocatedPrograms } from "./command-request.js";
import type { AllowedCommandRecord } from "./shell-records.js";

/** One step of a line as Always allow keeps it: the step as written, its program and arguments. */
export interface AllowedStep {
  readonly text: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly folder: string;
}

/**
 * How the allowed commands judge a command line (decision 0409): whether each of its steps is
 * allowed, why not when one is not, whether Always allow may keep it, and the steps it would keep.
 */
export interface LineJudgment {
  readonly listed: boolean;
  readonly miss?: Exclude<ShellAskReason, "always">;
  readonly canAlwaysAllow: boolean;
  readonly steps: readonly AllowedStep[];
}

// Programs whose run can change while their words stay the same: shells, interpreters, and
// launchers that run another program or a file of instructions.
const runsOtherCode: ReadonlySet<string> = new Set(
  (
    "sh bash zsh dash ksh mksh fish csh tcsh pwsh powershell nu xonsh elvish busybox toybox " +
    "node nodejs deno bun tsx ts-node ruby irb perl php lua luajit tclsh wish osascript rscript " +
    "julia java groovy scala swift awk gawk mawk nawk sed find xargs env sudo doas su nice nohup " +
    "timeout time stdbuf watch flock caffeinate arch xcrun sandbox-exec script expect make gmake " +
    "npx npm pnpm yarn bunx corepack uv uvx pip pipx poetry go cargo dotnet"
  ).split(" "),
);

// Versioned interpreters, such as `python3.12`, `perl5.34` or `node22`.
const versionedInterpreter = /^(?:python|pypy|perl|ruby|php|lua|node|pip)[\d.]*$/u;

function nameOf(program: string): string {
  const base = program.split(/[\\/]/u).at(-1) ?? program;
  return base.toLowerCase().replace(/\.exe$/u, "");
}

/** Whether a program runs code that can change while the command's words stay the same. */
export function runsOtherProgram(program: string): boolean {
  const name = nameOf(program);
  return runsOtherCode.has(name) || versionedInterpreter.test(name);
}

function isAllowed(step: AllowedStep, allowed: readonly AllowedCommandRecord[]): boolean {
  const key = JSON.stringify([step.program, step.args, step.folder]);
  return allowed.some((each) => JSON.stringify([each.program, each.args, each.folder]) === key);
}

const neverListed = (miss: LineJudgment["miss"]): LineJudgment => ({
  listed: false,
  ...(miss === undefined ? {} : { miss }),
  canAlwaysAllow: false,
  steps: [],
});

/**
 * Judges a command line against the allowed commands (decision 0409): each step's program, by the
 * real path `located` found, its arguments word for word and the line's folder must be one
 * allowed command's. A line on PowerShell, one the shell features make unreadable, or one with a
 * program not found is never listed; Always allow keeps a line only when every program is found
 * and none runs other code.
 */
export function judgeLine(
  line: CommandLine,
  where: { readonly located: LocatedPrograms; readonly dialect: "posix" | "powershell" },
  allowed: readonly AllowedCommandRecord[],
): LineJudgment {
  if (where.dialect === "powershell") {
    return neverListed("powershell");
  }
  if (line.kind === "unreadable") {
    return neverListed("unreadable");
  }
  const { folder, programs } = where.located;
  const steps = line.steps.flatMap((step, at): readonly AllowedStep[] => {
    const program = programs[at];
    return program === undefined
      ? []
      : [{ text: step.text, program, folder, args: step.words.slice(1) }];
  });
  if (steps.length < line.steps.length) {
    return neverListed("unlisted");
  }
  const listed = steps.every((step) => isAllowed(step, allowed));
  const canAlwaysAllow = !steps.some((step) => runsOtherProgram(step.program));
  return { listed, ...(listed ? {} : { miss: "unlisted" }), canAlwaysAllow, steps };
}
