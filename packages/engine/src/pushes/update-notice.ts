import type { EnginePush } from "./engine-push.js";
import { noticePush } from "./notice-push.js";

/**
 * How the owner installs a newer release: `update` names `binference update`, `manual` the steps
 * that stop binference, install it with npm and start it, where `binference update` does not run.
 */
export type UpdateSteps = "update" | "manual";

/**
 * The notice that a newer binference is out (spec 4, section 4.2): `notice.update` with the
 * release's notes in the owner's language as `{summary}`, one line each, or `notice.updateBare`
 * when the release has none in that language, and the steps that install it. It names no agent:
 * an update is the whole install's.
 */
export function updateNotice(
  version: string,
  notes: readonly string[],
  steps: UpdateSteps,
): EnginePush {
  return notes.length === 0
    ? noticePush({ key: "notice.updateBare", values: { version, steps } })
    : noticePush({ key: "notice.update", values: { version, steps, summary: notes.join("\n") } });
}

/**
 * The notice that binference is now the version `binference update` installed (spec 4, section
 * 4.2): `notice.updated` with its notes in the owner's language, or `notice.updatedBare`.
 */
export function updatedNotice(version: string, notes: readonly string[]): EnginePush {
  return notes.length === 0
    ? noticePush({ key: "notice.updatedBare", values: { version } })
    : noticePush({ key: "notice.updated", values: { version, summary: notes.join("\n") } });
}

/**
 * The notice that `version` failed its check after the update and `binference update` put
 * `previous` back, with the owner's settings and records as they were before (spec 4, section 4.2).
 */
export function updateRolledBackNotice(version: string, previous: string): EnginePush {
  return noticePush({ key: "notice.updateRolledBack", values: { version, previous } });
}
