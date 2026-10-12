import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { PaperFills } from "../paper/paper-fills.js";
import type { Executor } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { rescueNotice } from "../safety/rescue-notice.js";
import type { FillProposal } from "./authorize-simulated.js";

/**
 * The execute step of the money path (ARCHITECTURE.md section 7, step 8) for an intent the owner,
 * an auto order or the auto mode may have confirmed. A confirmed paper intent fills at its
 * confirmed quote and never reaches the executor (spec 6, invariant 3). A confirmed live intent,
 * which a rescue always is (decision 0100), goes to the executor, which takes it onto its wallet's
 * queue; a confirmed rescue is first announced on every surface with `notice.rescue`. A confirmed
 * unfreeze has no step: it is written at once (decision 0128). An auto order's card, answered in
 * any way, goes to its order, which follows it (decision 0189). An auto order's paper fill fills
 * with its order's write (decision 0195). Any other intent comes back as it was.
 */
export type ExecuteConfirmed = (
  snapshot: IntentSnapshot,
  options: {
    readonly signal: AbortSignal;
    /** The proposal of the auto order fill the money path authorized in this run, if any. */
    readonly fill?: FillProposal;
  },
) => Promise<IntentSnapshot>;

/**
 * Where a confirmed intent goes: the paper fill, the executor, or the unfreeze's write; and where
 * notices go.
 */
export interface ExecuteConfirmedOptions {
  readonly paper: PaperFills;
  readonly executor: Executor;
  readonly unfreeze: ExecuteConfirmed;
  /** Follows an auto order's card, whatever its answer: its order becomes active or ends. */
  readonly autoOrder: ExecuteConfirmed;
  /** Fills an auto order's confirmed paper fill, with its write on its order. */
  readonly orderFill: ExecuteConfirmed;
  readonly publish: PublishPush;
}

/** Creates the {@link ExecuteConfirmed} step over paper fills and the executor. */
export function createExecuteConfirmed(options: ExecuteConfirmedOptions): ExecuteConfirmed {
  return async (snapshot, call) => {
    const { record } = snapshot;
    if (record.kind === "autoOrder") {
      return options.autoOrder(snapshot, call);
    }
    if (record.state !== "confirmed") {
      return snapshot;
    }
    if (record.isPaper) {
      const { authorizedBy } = snapshot.stored.status;
      return authorizedBy !== undefined && isFillAuthorization(authorizedBy)
        ? options.orderFill(snapshot, call)
        : options.paper.fillAtQuote(snapshot, call);
    }
    if (record.kind === "unfreeze") {
      return options.unfreeze(snapshot, call);
    }
    const notice = record.kind === "rescue" ? rescueNotice(record) : undefined;
    if (notice !== undefined) {
      options.publish(notice);
    }
    await options.executor.take(record.id, call);
    return snapshot;
  };
}
