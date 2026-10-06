import { join } from "node:path";
import { runCommand } from "./run-command.mjs";
import type { Sandbox } from "./sandbox.mjs";

/** One command of a case, and how it must end. */
export interface GateStep {
  readonly command: readonly string[];
  readonly expect: "pass" | "fail";
  /** Text the output must contain, such as the name of the rule that fired. */
  readonly output?: readonly RegExp[];
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** A folder inside the sandbox to run in; the sandbox root by default. */
  readonly cwd?: string;
}

/** A planted change and the gate commands that must react to it. */
export interface GateCase {
  readonly name: string;
  readonly files?: Readonly<Record<string, string>>;
  /** Commits the planted files before the steps run, for checks that read git history. */
  readonly commitAs?: string;
  readonly steps: readonly GateStep[];
}

function checkStep(sandbox: Sandbox, step: GateStep): string | undefined {
  const result = runCommand(step.command, {
    cwd: join(sandbox.root, step.cwd ?? "."),
    ...(step.input === undefined ? {} : { input: step.input }),
    ...(step.env === undefined ? {} : { env: step.env }),
  });
  const passed = result.status === 0;
  const label = step.command.join(" ");
  if (passed !== (step.expect === "pass")) {
    const outcome = passed ? "passed" : `failed with exit code ${String(result.status)}`;
    return `${label} ${outcome}, expected it to ${step.expect}:\n${result.output.trim()}`;
  }
  const missing = (step.output ?? []).filter((pattern) => !pattern.test(result.output));
  if (missing.length > 0) {
    return `${label} printed no ${missing.join(", ")}:\n${result.output.trim()}`;
  }
  return undefined;
}

/** Plants a case in the sandbox, runs its steps and resets the sandbox. Returns the problem. */
export function runCase(sandbox: Sandbox, item: GateCase): string | undefined {
  try {
    sandbox.plant(item.files ?? {});
    if (item.commitAs !== undefined) {
      sandbox.commit(item.commitAs);
    }
    for (const step of item.steps) {
      const problem = checkStep(sandbox, step);
      if (problem !== undefined) {
        return problem;
      }
    }
    return undefined;
  } finally {
    sandbox.reset();
  }
}
