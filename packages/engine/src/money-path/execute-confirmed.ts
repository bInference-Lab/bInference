import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { PaperFills } from "../paper/paper-fills.js";
import type { Executor } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { rescueNotice } from "../safety/rescue-notice.js";

/**
 * The execute step of the money path (ARCHITECTURE.md section 7, step 8) for an intent the owner,
 * an auto order or the auto mode may have confirmed. A confirmed paper intent fills at its
 * confirmed quote and never reaches the executor (spec 6, invariant 3). A confirmed live intent,
 * which a rescue always is (decision 0100), goes to the executor, which takes it onto its wallet's
 * queue; a confirmed rescue is first announced on every surface with `notice.rescue`. Any other
 * intent comes back as it was.
 */
export type ExecuteConfirmed = (
  snapshot: IntentSnapshot,
  options: { readonly signal: AbortSignal },
) => Promise<IntentSnapshot>;

/** Where a confirmed intent goes: the paper fill or the executor; and where notices go. */
export interface ExecuteConfirmedOptions {
  readonly paper: PaperFills;
  readonly executor: Executor;
  readonly publish: PublishPush;
}

/** Creates the {@link ExecuteConfirmed} step over paper fills and the executor. */
export function createExecuteConfirmed(options: ExecuteConfirmedOptions): ExecuteConfirmed {
  return async (snapshot, call) => {
    const { record } = snapshot;
    if (record.state !== "confirmed") {
      return snapshot;
    }
    if (record.isPaper) {
      return options.paper.fillAtQuote(snapshot, call);
    }
    const notice = record.kind === "rescue" ? rescueNotice(record) : undefined;
    if (notice !== undefined) {
      options.publish(notice);
    }
    await options.executor.take(record.id, call);
    return snapshot;
  };
}
