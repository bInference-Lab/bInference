import { basename } from "node:path";
import type {
  ConfigFix,
  ConfigIssue,
  ConfigLayer,
  ConfigOrigin,
  ConfigProblem,
} from "./config-issue.js";
import { describeRule } from "./describe-rule.js";

const fileName = "config.json5";

function where(origin: ConfigOrigin): string {
  return origin.layer === "file" && origin.name !== "" ? basename(origin.name) : fileName;
}

type PlainProblem = Exclude<
  ConfigProblem["kind"],
  "unreadable" | "newer_version" | "older_version" | "bad_value" | "bad_key"
>;

const plainProblems: Readonly<Record<PlainProblem, string>> = {
  missing_file: "does not exist",
  unknown_key: "is not a config key",
  required: "is required",
  secret_inline: "holds a secret as plain text",
  bad_flag: "is not written as --set key=value",
};

function problemText(problem: ConfigProblem): string {
  if (problem.kind === "unreadable") {
    return `is not valid JSON5 at line ${String(problem.line)}, column ${String(problem.column)}`;
  }
  if (problem.kind === "newer_version") {
    return (
      `is version ${String(problem.version)}, from a newer binference; this one reads up to ` +
      `version ${String(problem.supported)}`
    );
  }
  if (problem.kind === "older_version") {
    return `is version ${String(problem.version)}; this binference reads version ${String(problem.current)}`;
  }
  if (problem.kind === "bad_value") {
    const takes = `must be ${describeRule(problem.rule)}`;
    return problem.got === "" ? takes : `${takes} (got ${problem.got})`;
  }
  if (problem.kind === "bad_key") {
    return `is not a valid key here; a key must be ${describeRule(problem.rule)}`;
  }
  return plainProblems[problem.kind];
}

const changeText: Readonly<Record<ConfigLayer, (origin: ConfigOrigin) => string>> = {
  env: (origin) => `Set ${origin.name} to a valid value or unset it.`,
  flag: (origin) => `Change the --set ${origin.name}= flag or leave it out.`,
  file: (origin) => `Set it in ${where(origin)} or remove it.`,
  default: (origin) => `Set it in ${where(origin)} or remove it.`,
};

const removeText: Readonly<Record<ConfigLayer, (origin: ConfigOrigin) => string>> = {
  env: (origin) => `Unset ${origin.name}, or check its spelling.`,
  flag: (origin) => `Leave out the --set ${origin.name}= flag, or check its spelling.`,
  file: (origin) => `Remove it from ${where(origin)}, or check its spelling.`,
  default: (origin) => `Remove it from ${where(origin)}, or check its spelling.`,
};

const fixText: Readonly<Record<ConfigFix, (origin: ConfigOrigin) => string>> = {
  run_init: () => "Run binference init to write it, or point --config at your file.",
  fix_syntax: (origin) => `Fix ${where(origin)} at that place.`,
  update_binference: (origin) => `Update binference, or restore a backup of ${where(origin)}.`,
  run_check_fix: () => "Run binference check --fix to migrate it.",
  remove_key: (origin) => removeText[origin.layer](origin),
  add_key: (origin) => `Add it to ${where(origin)}.`,
  change_value: (origin) => changeText[origin.layer](origin),
  use_secret_source: () =>
    "Run binference check --fix to move it to the keychain, or write a secret source such as " +
    '{ fromKeychain: "name" } instead.',
  fix_flag: () => "Write each flag as --set key=value.",
};

function subject(issue: ConfigIssue): string {
  if (issue.problem.kind === "bad_flag") {
    return `--set flag ${issue.origin.name}`;
  }
  if (issue.path === "") {
    return issue.origin.name === "" ? fileName : issue.origin.name;
  }
  return issue.origin.layer === "env" ? `${issue.path} (${issue.origin.name})` : issue.path;
}

/**
 * Writes an issue as one English line for developers and logs, such as
 * `engine.port: must be a number from 1024 to 65535 (got "abc"). Set it in config.json5 or remove it.`
 * Surfaces show the owner the same issue through i18n messages chosen by its problem and fix.
 */
export function formatConfigIssue(issue: ConfigIssue): string {
  return `${subject(issue)}: ${problemText(issue.problem)}. ${fixText[issue.fix](issue.origin)}`;
}
