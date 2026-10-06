import type { ValueRule } from "./config-tree.js";

/** The layers of the config, lowest first: each replaces the one below it key by key. */
export type ConfigLayer = "default" | "file" | "env" | "flag";

/** Where a value came from: its layer, and the file, variable or flag that set it. */
export interface ConfigOrigin {
  readonly layer: ConfigLayer;
  /** The file's path, the variable's name or the flag as typed; empty for a default. */
  readonly name: string;
}

/** What is wrong, as data a surface turns into words in the owner's language. */
export type ConfigProblem =
  | { readonly kind: "missing_file" }
  | { readonly kind: "unreadable"; readonly line: number; readonly column: number }
  | { readonly kind: "newer_version"; readonly version: number; readonly supported: number }
  | { readonly kind: "older_version"; readonly version: number; readonly current: number }
  | { readonly kind: "unknown_key" }
  | { readonly kind: "required" }
  | { readonly kind: "bad_value"; readonly rule: ValueRule; readonly got: string }
  | { readonly kind: "bad_key"; readonly rule: ValueRule }
  | { readonly kind: "secret_inline" }
  | { readonly kind: "bad_flag" };

/** The next step that fixes a problem. */
export type ConfigFix =
  | "run_init"
  | "fix_syntax"
  | "update_binference"
  | "run_check_fix"
  | "remove_key"
  | "add_key"
  | "change_value"
  | "use_secret_source"
  | "fix_flag";

/**
 * One problem with the config: the key's path, what is wrong, the fix and where the value came
 * from. Secrets never appear in it: an inline secret is named, never shown.
 */
export interface ConfigIssue {
  /** The key's path, such as `engine.port`; empty when the problem is the whole file. */
  readonly path: string;
  readonly problem: ConfigProblem;
  readonly fix: ConfigFix;
  readonly origin: ConfigOrigin;
}

/** The origin of every value no layer above the defaults set. */
export const defaultOrigin: ConfigOrigin = { layer: "default", name: "" };

const fixes: Readonly<Record<ConfigProblem["kind"], ConfigFix>> = {
  missing_file: "run_init",
  unreadable: "fix_syntax",
  newer_version: "update_binference",
  older_version: "run_check_fix",
  unknown_key: "remove_key",
  required: "add_key",
  bad_value: "change_value",
  bad_key: "change_value",
  secret_inline: "use_secret_source",
  bad_flag: "fix_flag",
};

/** Builds an issue with the fix its problem calls for. */
export function configIssue(
  path: readonly string[],
  problem: ConfigProblem,
  origin: ConfigOrigin,
): ConfigIssue {
  return { path: path.join("."), problem, fix: fixes[problem.kind], origin };
}
