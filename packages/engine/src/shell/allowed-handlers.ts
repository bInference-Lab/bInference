import { type Clock, err, type IdSource, jsonValueSchema, ok } from "@binference/core";
import type { AllowedCommandView } from "@binference/protocol";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { answererOf, type EngineCaller, type EngineHandler } from "../operations/engine-call.js";
import type { ConfigJournal } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { AllowedStep } from "./allowed-match.js";
import type { ShellStore } from "./ports.js";
import { shellAllowedNotice, shellDisallowedNotice } from "./shell-notices.js";
import type { AllowedCommandRecord } from "./shell-records.js";

/** The handlers of the commands the owner allowed always (protocol spec, section 7.11). */
export interface AllowedHandlers {
  readonly "shell/allowed": EngineHandler<"shell/allowed">;
  readonly "shell/disallow": EngineHandler<"shell/disallow">;
}

/** Where the allowed commands are kept, journaled and announced. */
export interface AllowedParts {
  readonly store: ShellStore;
  readonly journal: ConfigJournal;
  readonly publish: PublishPush;
  readonly ids: IdSource;
  readonly clock: Clock;
}

// The journal's path of the allowed commands (decision 0409).
const allowedPath = "shell.allowed";

/** An allowed command as the protocol shows it. */
function viewOf(record: AllowedCommandRecord): AllowedCommandView {
  const { id, text, program, args, folder, allowedAtMs } = record;
  return { allowed: id, text, program, args, folder, allowedAt: allowedAtMs };
}

/**
 * Keeps the steps of a line the owner allowed always (decision 0409), those not kept yet, and
 * journals and announces the ones it kept, by the owner's surface.
 */
export async function keepAllowed(
  parts: AllowedParts,
  steps: readonly AllowedStep[],
  call: { readonly caller: EngineCaller; readonly signal: AbortSignal },
): Promise<void> {
  const atMs = parts.clock.now();
  const records = steps.map((step) => ({ id: parts.ids.next("sac"), ...step, allowedAtMs: atMs }));
  const kept = await parts.store.allow(records, call);
  if (kept.length === 0) {
    return;
  }
  const by = answererOf(call.caller).surface;
  await journalConfigChange(
    parts,
    {
      author: authorOf(call.caller),
      atMs,
      path: allowedPath,
      after: jsonValueSchema.parse(kept.map(viewOf)),
      notices: [shellAllowedNotice(kept, by)],
    },
    call,
  );
}

/**
 * Creates `shell/allowed`, every allowed command in the order they were kept, and
 * `shell/disallow`, which removes one, journaled under `shell.allowed` and announced
 * (decision 0409); one no row holds is `shell.allowed_not_found`.
 */
export function createAllowedHandlers(parts: AllowedParts): AllowedHandlers {
  return {
    "shell/allowed": async (call) => ok({ items: (await parts.store.allowed(call)).map(viewOf) }),
    "shell/disallow": async (call) => {
      const removed = await parts.store.disallow(call.args.allowed, call);
      if (removed === undefined) {
        return err("shell.allowed_not_found");
      }
      const by = answererOf(call.caller).surface;
      await journalConfigChange(
        parts,
        {
          author: authorOf(call.caller),
          atMs: parts.clock.now(),
          path: allowedPath,
          before: jsonValueSchema.parse(viewOf(removed)),
          notices: [shellDisallowedNotice(removed, by)],
        },
        call,
      );
      return ok({});
    },
  };
}
