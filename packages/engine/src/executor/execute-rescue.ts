import type { AccountRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import { type ExecutionRun, moveIntent, nextBlock, readSafely } from "./executor-run.js";
import type { IntentPlan } from "./intent-plan.js";
import type { SigningTerms } from "./queue-check.js";
import { reconcileRescue } from "./reconcile-rescue.js";
import { currentSteps } from "./recover-steps.js";
import { checkRescueForQueue } from "./rescue-queue-check.js";
import { prepareStep, signAndStore } from "./run-step.js";
import { sendAndWatch, type Watched } from "./send-and-watch.js";
import { rivalsOf } from "./step-fate.js";
import { stuckRulesOf } from "./stuck-rules.js";
import { watchFinality } from "./watch-finality.js";

/** One wallet's part of a rescue: its account, which keys its queue, and its steps in order. */
export interface RescueGroup {
  readonly account: AccountRef;
  readonly indexes: readonly number[];
}

/** How one step of a rescue ended: in a block, failed after its retries, or stuck at its nonce. */
type StepEnd =
  | { readonly kind: "landed"; readonly transaction: TransactionRecord }
  | { readonly kind: "failed" | "stuck" };

/** One step to send, with the intent and the terms every signature carries. */
interface RescueStep {
  readonly record: IntentRecord;
  readonly terms: SigningTerms;
  readonly index: number;
}

// Spec 6, section 5: a rescue's step that fails is tried again up to three times.
const rescueRetries = 3;

/** Each wallet's steps of a plan, the wallets in the order their first step comes. */
export function rescueGroupsOf(plan: IntentPlan): readonly RescueGroup[] {
  const accounts = [...new Set(plan.steps.map(({ from }) => from))];
  return accounts.map((account) => ({
    account,
    indexes: plan.steps.flatMap(({ from }, index) => (from === account ? [index] : [])),
  }));
}

// Waits until the head's final block reaches `block`, for at most the finality wait.
async function waitFinal(run: ExecutionRun, block: bigint, waits = 0): Promise<boolean> {
  const { plan, parts, signal } = run;
  const head = await readSafely(run, async () =>
    plan.sending.receipts.head(plan.chain.ref, { signal }),
  );
  if (head !== undefined && head.final >= block) {
    return true;
  }
  if (waits >= parts.limits.finalAfterBlocks) {
    return false;
  }
  await nextBlock(run);
  return waitFinal(run, block, waits + 1);
}

async function watchStored(
  run: ExecutionRun,
  slot: WalletSlot,
  step: RescueStep & { readonly transaction: TransactionRecord },
): Promise<Watched> {
  const { record, terms, transaction } = step;
  const stored = await run.parts.stores.transactions.ofIntent(record.id, { signal: run.signal });
  const rules = stuckRulesOf(run, { slot, terms });
  return sendAndWatch(run, {
    intent: record,
    transaction,
    rivals: rivalsOf(stored, transaction),
    rules,
  });
}

// One try: prepared on the latest state, which simulates it again, signed, stored, then sent and
// watched. `undefined` when it was never signed, as when its fee per gas is above the network fee
// cap (decision 0102).
async function sendFresh(
  run: ExecutionRun,
  slot: WalletSlot,
  step: RescueStep,
): Promise<Watched | undefined> {
  const draft = run.plan.steps[step.index];
  if (draft === undefined || run.stopping.aborted) {
    return undefined;
  }
  const ready = await prepareStep(run, slot, { index: step.index, draft });
  if (!ready.ok || ready.value.prepared.isAboveFeeCap) {
    return undefined;
  }
  const { record, terms } = step;
  const stored = await signAndStore(run, slot, { record, terms, ready: ready.value });
  return stored.ok ? watchStored(run, slot, { ...step, transaction: stored.value }) : undefined;
}

// A step in a block is done; one stuck at its nonce holds the wallet, so its wallet stops there.
function endOf(
  run: ExecutionRun,
  step: RescueStep,
  watched: Watched | undefined,
): StepEnd | undefined {
  if (watched?.outcome === "included") {
    return { kind: "landed", transaction: watched.transaction };
  }
  if (watched?.outcome === "stuck") {
    run.parts.log.warn("executor.step_stopped", { intentId: step.record.id, errorCode: "stuck" });
    return { kind: "stuck" };
  }
  return undefined;
}

// A step that failed is tried again once the transaction that failed is final (spec 6, section
// 5), or a block later when none landed, while tries are left and the engine is not stopping.
async function mayRetry(
  run: ExecutionRun,
  step: { readonly tries: number; readonly watched: Watched | undefined },
): Promise<boolean> {
  const block = step.watched?.transaction.receipt?.block.number;
  if (step.tries >= rescueRetries || run.stopping.aborted) {
    return false;
  }
  if (block !== undefined) {
    return waitFinal(run, block);
  }
  await nextBlock(run);
  return true;
}

async function settleStep(
  run: ExecutionRun,
  slot: WalletSlot,
  step: RescueStep & { readonly tries: number; readonly watched: Watched | undefined },
): Promise<StepEnd> {
  const end = endOf(run, step, step.watched);
  if (end !== undefined) {
    return end;
  }
  if (!(await mayRetry(run, step))) {
    run.parts.log.warn("executor.rescue_step_failed", { intentId: step.record.id });
    return { kind: "failed" };
  }
  const again = await sendFresh(run, slot, step);
  return settleStep(run, slot, { ...step, tries: step.tries + 1, watched: again });
}

// A step a stop left in a block is done, one it left signed or sent goes on with its own bytes,
// and any other is sent now.
async function sendStep(run: ExecutionRun, slot: WalletSlot, step: RescueStep): Promise<StepEnd> {
  const stored = await run.parts.stores.transactions.ofIntent(step.record.id, {
    signal: run.signal,
  });
  const transaction = currentSteps(stored).get(step.index);
  if (transaction?.state === "included" || transaction?.state === "final") {
    return { kind: "landed", transaction };
  }
  const isPending = transaction?.state === "signed" || transaction?.state === "sent";
  const watched = isPending
    ? await watchStored(run, slot, { ...step, transaction })
    : await sendFresh(run, slot, step);
  return settleStep(run, slot, { ...step, tries: 0, watched });
}

// One wallet's steps in order, on its slot; a step stuck at its nonce ends the wallet's part.
async function sendGroup(
  run: ExecutionRun,
  slot: WalletSlot,
  part: { readonly step: Omit<RescueStep, "index">; readonly indexes: readonly number[] },
): Promise<readonly TransactionRecord[]> {
  const [index, ...rest] = part.indexes;
  if (index === undefined || run.stopping.aborted) {
    return [];
  }
  const end = await sendStep(run, slot, { ...part.step, index });
  if (end.kind === "stuck") {
    return [];
  }
  const later = await sendGroup(run, slot, { ...part, indexes: rest });
  return end.kind === "landed" ? [end.transaction, ...later] : later;
}

/** A rescue the queue took, with the terms its signatures carry. */
interface TakenRescue {
  readonly snapshot: IntentSnapshot;
  readonly terms: SigningTerms;
}

// A confirmed rescue moves to `executing` once the queue check passes; one a stop left
// `executing` goes on from where it stands.
async function takeRescue(run: ExecutionRun, intent: Id<"int">): Promise<TakenRescue | undefined> {
  const { parts, signal } = run;
  const snapshot = await parts.stored.snapshot(intent, { signal });
  const state = snapshot?.record.state;
  if (snapshot === undefined || (state !== "confirmed" && state !== "executing")) {
    return undefined;
  }
  const rescueParts = { intents: parts.intents, install: parts.stores.install, clock: parts.clock };
  const check = await checkRescueForQueue(snapshot, rescueParts, signal);
  if (check.terms === undefined) {
    parts.log.warn("executor.not_taken", { intentId: intent, errorCode: "no_authorization" });
    return undefined;
  }
  const taken =
    state === "executing"
      ? snapshot
      : await moveIntent(run, snapshot, { type: "queue_took", ...check.facts });
  return taken === undefined ? undefined : { snapshot: taken, terms: check.terms };
}

// The rest of the wallets, each on its own queue in turn, after the first.
async function sendRest(
  run: ExecutionRun,
  taken: TakenRescue,
  groups: readonly RescueGroup[],
): Promise<readonly TransactionRecord[] | undefined> {
  const [group, ...rest] = groups;
  if (group === undefined) {
    return [];
  }
  const step = { record: taken.snapshot.record, terms: taken.terms };
  const landed = await run.parts.queue.run(
    group.account,
    async (slot) => sendGroup(run, slot, { step, indexes: group.indexes }),
    { signal: run.stopping },
  );
  const later = landed === undefined ? undefined : await sendRest(run, taken, rest);
  return landed === undefined || later === undefined ? undefined : [...landed, ...later];
}

/**
 * Runs a confirmed rescue (decision 0044; spec 6, section 5): the first wallet's queue takes it
 * after the queue check, then each wallet's steps run in order on that wallet's own queue, the
 * wallets one after another, each step signed by its move's wallet. A step that fails is tried
 * again up to three times, each only once the transaction that failed is final and the step
 * prepares again on the latest state; a step stuck at its nonce ends its wallet's part. Once every
 * step has its last outcome the rescue is `included`, waits for its landed steps' blocks to be
 * final, and reconciles: what its sends took out of each wallet leaves the positions at average
 * cost (decision 0127). It resumes a rescue a stop left `executing`: a step in a block is done
 * and one signed or sent goes on with its own bytes. Once the engine begins to stop, no step
 * starts and the rescue stays where it is.
 */
export async function executeRescue(
  run: ExecutionRun,
  rescue: { readonly intent: Id<"int">; readonly groups: readonly RescueGroup[] },
): Promise<void> {
  const [first, ...rest] = rescue.groups;
  if (first === undefined) {
    return;
  }
  const head = await run.parts.queue.run(
    first.account,
    async (slot) => {
      const taken = await takeRescue(run, rescue.intent);
      const step =
        taken === undefined ? undefined : { record: taken.snapshot.record, terms: taken.terms };
      return taken === undefined || step === undefined
        ? undefined
        : { taken, landed: await sendGroup(run, slot, { step, indexes: first.indexes }) };
    },
    { signal: run.stopping },
  );
  const later = head === undefined ? undefined : await sendRest(run, head.taken, rest);
  if (head === undefined || later === undefined || run.stopping.aborted) {
    return;
  }
  const included = await moveIntent(run, head.taken.snapshot, { type: "steps_included" });
  const landed = [...head.landed, ...later].filter(({ state }) => state !== "final");
  const finalized = included === undefined ? undefined : await watchFinality(run, included, landed);
  if (finalized !== undefined) {
    await reconcileRescue(run, finalized);
  }
}

// The landed steps of a rescue a stop left `included`, still waiting for their blocks to be final.
async function landedSteps(
  run: ExecutionRun,
  intent: Id<"int">,
): Promise<readonly TransactionRecord[]> {
  const stored = await run.parts.stores.transactions.ofIntent(intent, { signal: run.signal });
  return [...currentSteps(stored).values()].filter(({ state }) => state === "included");
}

/**
 * Goes on with a rescue a stop left unsettled: one `executing` runs on from where it stands, as
 * {@link executeRescue} does, so a step signed or sent before the stop is never signed again; one
 * `included` waits for its landed steps' blocks to be final, and one `finalized` reconciles. Any
 * other is left as it is.
 */
export async function recoverRescue(run: ExecutionRun, snapshot: IntentSnapshot): Promise<void> {
  const { id, state } = snapshot.record;
  if (state === "executing") {
    return executeRescue(run, { intent: id, groups: rescueGroupsOf(run.plan) });
  }
  if (state !== "included" && state !== "finalized") {
    return undefined;
  }
  const finalized =
    state === "finalized"
      ? snapshot
      : await watchFinality(run, snapshot, await landedSteps(run, id));
  if (finalized !== undefined) {
    await reconcileRescue(run, finalized);
  }
  return undefined;
}
