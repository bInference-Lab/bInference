import type { AccountRef } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import type { ExecutionRun, ExecutorParts } from "./executor-run.js";
import { type IntentPlan, intentPlanOf } from "./intent-plan.js";
import { reconcileTrade } from "./reconcile-trade.js";
import { currentSteps, recoverSteps } from "./recover-steps.js";
import { settleIncluded } from "./settle-included.js";

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

async function listFrom(
  parts: ExecutorParts,
  signal: AbortSignal,
  after?: Pick<IntentRecord, "changedAtMs" | "id">,
): Promise<readonly IntentRecord[]> {
  const query = {
    states: unsettledStates,
    isPaper: false,
    limit: pageSize,
    ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
  };
  const page = await parts.intents.list(query, { signal });
  const last = page.at(-1);
  return page.length < pageSize || last === undefined
    ? page
    : [...page, ...(await listFrom(parts, signal, last))];
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
  const records = await listFrom(parts, signal);
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
 * signed.
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
    async () => {
      const stored = await parts.stores.transactions.ofIntent(intent, { signal });
      return recoverSteps(run, snapshot, stored);
    },
    { signal },
  );
  return included === undefined ? undefined : settleIncluded(run, included);
}
