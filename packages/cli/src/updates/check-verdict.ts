import { z } from "zod";
import type { CliHost } from "../program/cli-host.js";
import { runInstalled } from "./installed-commands.js";

// A check of the install reads files and asks the engine once; past this it did not answer.
const checkBudgetMs = 120_000;

/** One finding as `check --json` prints it: its check id and its level. */
interface CheckLevelOf {
  readonly check: string;
  readonly level: string;
}

const checkJsonSchema = z.object({
  findings: z.array(z.looseObject({ check: z.string(), level: z.string() })),
});

/** The check ids that fail among the findings, each once. */
export function failingChecks(findings: readonly CheckLevelOf[]): readonly string[] {
  return [...new Set(findings.filter((item) => item.level === "fail").map((item) => item.check))];
}

// The findings `check --json` printed, from its last line that reads as them.
function findingsOf(stdout: string): readonly CheckLevelOf[] | undefined {
  for (const line of stdout.trim().split("\n").toReversed()) {
    try {
      const parsed = checkJsonSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        return parsed.data.findings;
      }
    } catch {
      // A line that is not JSON is a line for people; the findings come on their own line.
    }
  }
  return undefined;
}

/**
 * Runs the installed program's own `binference check --json` as a program of its own, the version
 * npm put in place, and answers its failing check ids; `undefined` when it printed no findings.
 */
export async function installedChecks(
  host: CliHost,
  signal: AbortSignal,
): Promise<readonly string[] | undefined> {
  const args = ["check", "--json"];
  const exit = await runInstalled(host, { args, budgetMs: checkBudgetMs }, signal);
  const findings = findingsOf(exit.stdout);
  return findings === undefined ? undefined : failingChecks(findings);
}

/**
 * The check ids the new version fails and the old one did not (decision 0356): what rolls an
 * update back. A failure the install had before is not the update's.
 */
export function newFailures(
  before: readonly string[],
  after: readonly string[],
): readonly string[] {
  return after.filter((check) => !before.includes(check));
}
