import { type JsonValue, jsonValueSchema } from "@binference/core";
import { answererOf, type EngineCaller } from "../operations/engine-call.js";
import type { ConfigJournal } from "../ports.js";
import type { EnginePush, PublishPush } from "../pushes/engine-push.js";
import type { ConfigJournalEntry } from "./config-change.js";

/** Where a config change is journaled and announced. */
export interface ConfigChangeParts {
  readonly journal: ConfigJournal;
  readonly publish: PublishPush;
}

/**
 * One change to a setting or a limit: who made it, when, the path, its value before and after
 * (absent for a new or a removed one), and the notices that announce it on every surface.
 */
export interface ConfigChangeMade {
  readonly caller: EngineCaller;
  readonly atMs: number;
  /** The setting's path, such as `agents.main.limits`. */
  readonly path: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly notices?: readonly EnginePush[];
}

/**
 * Journals a change with who made it and on which surface (ARCHITECTURE.md section 24), pushes
 * the entry as `config/changed` on topic `config`, then publishes each notice that announces it.
 * Every writer of a setting or a limit goes through it, so no change escapes the journal.
 */
export async function journalConfigChange(
  parts: ConfigChangeParts,
  change: ConfigChangeMade,
  options: { readonly signal: AbortSignal },
): Promise<ConfigJournalEntry> {
  const { caller, atMs, path, before, after, notices = [] } = change;
  const entry = await parts.journal.record(
    {
      atMs,
      by: caller.credential,
      surface: answererOf(caller).surface,
      path,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    },
    options,
  );
  parts.publish({ topic: "config", kind: "config/changed", data: jsonValueSchema.parse(entry) });
  notices.forEach((notice) => parts.publish(notice));
  return entry;
}
