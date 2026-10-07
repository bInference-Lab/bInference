import type { MessageValues } from "@binference/i18n";
import type { ConfigFix, ConfigIssue, ConfigOrigin } from "../config/config-issue.js";

/** One message of the `cli` area with its values. */
export interface CliMessage {
  readonly key: string;
  readonly values: MessageValues;
}

const fileName = "config.json5";

function fileOf(origin: ConfigOrigin): string {
  return origin.layer === "file" && origin.name !== "" ? origin.name : fileName;
}

// The key's path, with the variable that set it when one did.
function subjectOf(issue: ConfigIssue): string {
  return issue.origin.layer === "env" ? `${issue.path} (${issue.origin.name})` : issue.path;
}

// Every value a problem's message may name; ICU leaves out the ones a message does not use.
function problemValues(issue: ConfigIssue): MessageValues {
  const { problem, origin } = issue;
  const values = { file: fileOf(origin), path: subjectOf(issue), flag: `--set ${origin.name}` };
  if (problem.kind === "unreadable") {
    return { ...values, line: String(problem.line), column: String(problem.column) };
  }
  if (problem.kind === "newer_version") {
    return { ...values, version: String(problem.version), supported: String(problem.supported) };
  }
  if (problem.kind === "older_version") {
    return { ...values, version: String(problem.version), current: String(problem.current) };
  }
  return problem.kind === "bad_value" ? { ...values, got: problem.got } : values;
}

function problemOf(issue: ConfigIssue): CliMessage {
  const { problem } = issue;
  const unseen = problem.kind === "bad_value" && problem.got === "";
  return {
    key: unseen ? "config.bad_value_unseen" : `config.${problem.kind}`,
    values: problemValues(issue),
  };
}

// Fixes that name where the value came from: a file, a variable or a flag.
const layered: ReadonlySet<ConfigFix> = new Set(["remove_key", "change_value"]);

function fixOf(issue: ConfigIssue): CliMessage {
  const { fix, origin } = issue;
  if (layered.has(fix)) {
    if (origin.layer === "env") {
      return { key: `configFix.${fix}.env`, values: { variable: origin.name } };
    }
    if (origin.layer === "flag") {
      return { key: `configFix.${fix}.flag`, values: { flag: `--set ${origin.name}=` } };
    }
    return { key: `configFix.${fix}.file`, values: { file: fileOf(origin) } };
  }
  return { key: `configFix.${fix}`, values: { file: fileOf(origin) } };
}

/**
 * The two messages a person reads for one config issue: what is wrong with the key, and the next
 * step that fixes it, in the owner's language. Secrets never reach them: an issue holds none.
 */
export function configIssueMessages(issue: ConfigIssue): readonly [CliMessage, CliMessage] {
  return [problemOf(issue), fixOf(issue)];
}
