import type { JsonValue } from "@binference/core";
import type { ConfigIssue } from "../config/config-issue.js";
import type { CliOutput } from "../program/cli-output.js";
import { configIssueMessages } from "./config-issue-messages.js";

function issuesOf(issues: readonly ConfigIssue[]): JsonValue {
  return issues.map((issue) => ({
    path: issue.path,
    problem: issue.problem.kind,
    fix: issue.fix,
    layer: issue.origin.layer,
  }));
}

/**
 * Refuses a start over a config that does not load: `config.invalid` with each issue for
 * scripts, and for people the count, then each issue with its fix.
 */
export function refuseConfig(output: CliOutput, issues: readonly ConfigIssue[]): void {
  output.fail({
    code: "config.invalid",
    key: "start.configInvalid",
    values: { file: "config.json5", count: issues.length },
    details: issuesOf(issues),
  });
  for (const issue of issues) {
    configIssueMessages(issue).forEach(({ key, values }) => output.explain(key, values));
  }
}
