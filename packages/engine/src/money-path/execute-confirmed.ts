import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentKind } from "../intents/intent-kind.js";
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
 * any way, goes to its order, which follows it (decision 0189), and a webhook rule's card to its rule
 * (decision 0299). An auto order's paper fill fills
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
  /** Applies a confirmed config change and ends its intent (decision 0393). */
  readonly configChange: ExecuteConfirmed;
  /** Follows an auto order's card, whatever its answer: its order becomes active or ends. */
  readonly autoOrder: ExecuteConfirmed;
  /** Follows a webhook rule's card, whatever its answer: its rule becomes active or ends. */
  readonly webhookRule: ExecuteConfirmed;
  /** Fills an auto order's confirmed paper fill, with its write on its order. */
  readonly orderFill: ExecuteConfirmed;
  /** Fills a webhook rule's confirmed paper fill, with its write on its alert and rule. */
  readonly ruleFill: ExecuteConfirmed;
  /** Fills a confirmed paper staking move at its paper plan (decision 0327). */
  readonly paperStake: ExecuteConfirmed;
  readonly publish: PublishPush;
}

// A paper staking move fills at its paper plan; any other paper intent at its confirmed quote.
function paperFillOf(options: ExecuteConfirmedOptions, kind: IntentKind): ExecuteConfirmed {
  return kind === "stake"
    ? options.paperStake
    : async (snapshot, call) => options.paper.fillAtQuote(snapshot, call);
}

// A confirmed paper intent fills on paper: a webhook rule's or an auto order's fill with its write,
// a staking move at its plan, any other at its quote.
function paperRouteOf(
  options: ExecuteConfirmedOptions,
  snapshot: IntentSnapshot,
): ExecuteConfirmed {
  const { authorizedBy } = snapshot.stored.status;
  if (authorizedBy !== undefined && "webhookRule" in authorizedBy) {
    return options.ruleFill;
  }
  return authorizedBy !== undefined && isFillAuthorization(authorizedBy)
    ? options.orderFill
    : paperFillOf(options, snapshot.record.kind);
}

/** Creates the {@link ExecuteConfirmed} step over paper fills and the executor. */
export function createExecuteConfirmed(options: ExecuteConfirmedOptions): ExecuteConfirmed {
  return async (snapshot, call) => {
    const { record } = snapshot;
    if (record.kind === "autoOrder") {
      return options.autoOrder(snapshot, call);
    }
    if (record.kind === "webhookRule") {
      return options.webhookRule(snapshot, call);
    }
    if (record.state !== "confirmed") {
      return snapshot;
    }
    if (record.kind === "configChange") {
      return options.configChange(snapshot, call);
    }
    if (record.isPaper) {
      return paperRouteOf(options, snapshot)(snapshot, call);
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
