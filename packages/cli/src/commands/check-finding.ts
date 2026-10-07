import type { JsonValue } from "@binference/core";
import type { CliMessage } from "./config-issue-messages.js";

/**
 * How one check of `binference check` stands: `ok`, `warn` for what the owner should know, `fail`
 * for a problem, and `skip` when this system gives the check nothing to read.
 */
export type CheckLevel = "ok" | "warn" | "fail" | "skip";

/** One finding of `binference check`, under a check id that never changes. */
export interface CheckFinding {
  /** The stable check id, such as `permissions.config_file`. */
  readonly check: string;
  readonly level: CheckLevel;
  /** What a person reads about a warning or a problem; nothing for one that is fine. */
  readonly message?: CliMessage;
  /** The lines that explain it, such as each config issue and its fix. */
  readonly more?: readonly CliMessage[];
  /** What scripts read beside the id and the level, such as the path. */
  readonly details?: { readonly [key: string]: JsonValue };
  /** Set once `check --fix` repaired it. */
  readonly fixed?: CliMessage;
}
