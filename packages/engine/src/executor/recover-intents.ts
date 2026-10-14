import type { AccountRef } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import type { ExecutionRun, ExecutorParts } from "./executor-run.js";
import { type IntentPlan, intentPlanOf } from "./intent-plan.js";
import { reconcileTrade } from "./reconcile-trade.js";
import { currentSteps, recoverSteps } from "./recover-steps.js";
import { settleIncluded } from "./settle-included.js";
import { type DroppedStep, droppedWatchEndsAt, watchDropped } from "./watch-dropped.js";

// The states a stop can leave a live intent in before it reconciles.
const unsettledStates: readonly IntentState[] = [
  "executing",
  "unknown_after_send",
  "included",
  "finalized",
];

/** A live intent a restart found unsettled: as it stands, its plan, and its wallet's account. */
export interface Unsettled {
  readonly snapshot: IntentSnapshot;
  readonly plan: IntentPlan;
  /** The account its steps come from, which keys its wallet's queue. */
  readonly account: AccountRef;
}

const pageSize = 100;

/**
 * Every live intent in one of `states` that runs on a chain, the least recently changed first,
 * read a page at a time. An unfreeze and an auto order's card have no step, so the executor never takes one
 * (decisions 0128 and 0189).
 */
export async function liveIntentsIn(
  parts: Pick<ExecutorParts, "intents">,
  states: readonly IntentState[],
  call: { readonly signal: AbortSignal; readonly after?: Pick<IntentRecord, "changedAtMs" | "id"> },
): Promise<readonly IntentRecord[]> {
  const { signal, after } = call;
  const query = {
    states,
    isPaper: false,
    limit: pageSize,
    ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
  };
  const page = await parts.intents.list(query, { signal });
  const last = page.at(-1);
  const onChain = page.filter(({ kind }) => kind !== "unfreeze" && kind !== "autoOrder");
  return page.length < pageSize || last === undefined
    ? onChain
    : [...onChain, ...(await liveIntentsIn(parts, states, { signal, after: last }))];
}

async function unsettledOf(
  parts: ExecutorParts,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<Unsettled | undefined> {
  const planned = intentPlanOf(record, parts);
  const snapshot = await parts.stored.snapshot(record.id, { signal });
  if ("problem" in planned || snapshot === undefined) {
    const errorCode = "problem" in planned ? planned.problem : "not_found";
    parts.log.error("executor.not_recovered", { intentId: record.id, errorCode });
    return undefined;
  }
  const { plan } = planned;
  return { snapshot, plan, account: plan.steps[0].from };
}

/**
 * Every live intent a stop left between `executing` and `reconciled`, the least recently
 * changed first, with its plan. An intent whose plan cannot be read is logged and left as it is.
 */
export async function unsettledIntents(
  parts: ExecutorParts,
  signal: AbortSignal,
): Promise<readonly Unsettled[]> {
  const records = await liveIntentsIn(parts, unsettledStates, { signal });
  const found = await Promise.all(
    records.map(async (record) => unsettledOf(parts, record, signal)),
  );
  return found.filter((unsettled) => unsettled !== undefined);
}

/**
 * Recovers one unsettled intent (spec 6, section 7). One whose steps' fates the chain decides
 * runs on its wallet's queue first, and takes its place in the queue as this call starts, so a
 * later intent of the wallet waits for it; then, as one whose steps all are in blocks, it waits
 * for finality off the queue and reconciles. A finalized intent reconciles at once. Nothing is
 * signed, but a live fill's later steps (decision 0211).
 */
export async function recoverIntent(run: ExecutionRun, unsettled: Unsettled): Promise<void> {
  const { snapshot, account } = unsettled;
  const { parts, signal } = run;
  const intent = snapshot.record.id;
  const { state } = snapshot.record;
  if (state === "finalized") {
    return reconcileTrade(run, snapshot);
  }
  if (state === "included") {
    const stored = await parts.stores.transactions.ofIntent(intent, { signal });
    const steps = [...currentSteps(stored).values()];
    return settleIncluded(run, { included: snapshot, steps });
  }
  const included = await parts.queue.run(
    account,
    async (slot) => {
      const stored = await parts.stores.transactions.ofIntent(intent, { signal });
      return recoverSteps(run, slot, { snapshot, stored });
    },
    { signal: run.stopping },
  );
  if (included === undefined) {
    return undefined;
  }
  return "dropped" in included ? watchDropped(run, included) : settleIncluded(run, included);
}

/**
 * Every live intent a drop ended whose dropped step a stop left under watch (decision 0211): ended
 * `failed_onchain` with `stuck_dropped` no longer ago than the watch lasts, with the step's
 * transaction recorded `dropped`, so a restart watches it again for the time left.
 */
export async function droppedUnderWatch(
  parts: ExecutorParts,
  signal: AbortSignal,
): Promise<readonly { readonly plan: IntentPlan; readonly step: DroppedStep }[]> {
  const records = await liveIntentsIn(parts, ["failed_onchain"], { signal });
  const dropped = records.filter(({ reason }) => reason === "stuck_dropped");
  const found = await Promise.all(dropped.map(async (record) => droppedOf(parts, record, signal)));
  return found.filter((watch) => watch !== undefined);
}

async function droppedOf(
  parts: ExecutorParts,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<{ readonly plan: IntentPlan; readonly step: DroppedStep } | undefined> {
  const planned = intentPlanOf(record, parts);
  if ("problem" in planned) {
    return undefined;
  }
  const { plan } = planned;
  if (parts.clock.now() >= droppedWatchEndsAt({ parts, plan }, record.changedAtMs)) {
    return undefined;
  }
  const stored = await parts.stores.transactions.ofIntent(record.id, { signal });
  const transaction = stored.findLast(({ state }) => state === "dropped");
  return transaction === undefined
    ? undefined
    : { plan, step: { intent: record, dropped: transaction } };
}
