import { BinferenceError } from "@binference/core";
import type { InboxEntry, InboxStore } from "@binference/engine";
import { chatUpdateSchema } from "../updates/chat-update.schema.js";
import { storedUpdateSchema } from "../updates/stored-update.js";
import { type ActionContext, actOnUpdate } from "./act-on-update.js";
import { decideUpdate, type UpdateAction } from "./decide-update.js";

/** `handled` once marked handled; `later` when a retryable fault leaves it for the next pass. */
export type EntryOutcome = "handled" | "later";

/** What handling a stored update needs. */
export interface EntryContext extends ActionContext {
  readonly inbox: InboxStore;
}

interface Call {
  readonly signal: AbortSignal;
}

async function actionFor(entry: InboxEntry, context: EntryContext, call: Call) {
  const stored = storedUpdateSchema.safeParse(entry.payload);
  const update = stored.success ? chatUpdateSchema.safeParse(stored.data.update) : undefined;
  if (!stored.success || update?.success !== true) {
    context.logger.warn("telegram.unreadable_entry");
    return { kind: "ignore" } satisfies UpdateAction;
  }
  const owner = await context.owners.get(call);
  return decideUpdate({ update: update.data, isRedacted: stored.data.isRedacted, owner });
}

/**
 * Decides and carries out one stored update, then marks it handled. A retryable fault leaves it
 * unhandled for the next pass; any other fault is logged by its code and the update is dropped,
 * so one bad update never blocks the ones after it.
 */
export async function handleEntry(
  entry: InboxEntry,
  context: EntryContext,
  call: Call,
): Promise<EntryOutcome> {
  try {
    await actOnUpdate(await actionFor(entry, context, call), context, call);
  } catch (error) {
    call.signal.throwIfAborted();
    const fault = error instanceof BinferenceError ? error : undefined;
    if (fault?.retryable === true) {
      context.logger.warn("telegram.handling_deferred", { errorCode: fault.code });
      return "later";
    }
    context.logger.error("telegram.handling_failed", { errorCode: fault?.code ?? "unexpected" });
  }
  await context.inbox.markHandled({ id: entry.id, atMs: context.clock.now() }, call);
  return "handled";
}
