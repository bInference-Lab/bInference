import type { TxDraft } from "@binference/chain";
import { type Id, ok, type Result } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import { endDropped } from "./end-dropped.js";
import { endUnsent } from "./end-unsent.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { checkForQueue, type SigningTerms } from "./queue-check.js";
import { type PreparedStep, prepareStep, signAndStore } from "./run-step.js";
import { sendAndWatch, type Watched } from "./send-and-watch.js";
import { stuckRulesOf } from "./stuck-rules.js";

/** Every step of an intent in a block, with the intent moved to `included`. */
export interface IncludedSteps {
  readonly included: IntentSnapshot;
  readonly steps: readonly TransactionRecord[];
}

/** An intent the queue took, moved to `executing`, with what signs its steps. */
interface Taken {
  readonly snapshot: IntentSnapshot;
  readonly terms: SigningTerms;
  readonly isAuto: boolean;
  readonly first: PreparedStep;
}

function notTaken(run: ExecutionRun, intent: Id<"int">, problem: string): undefined {
  run.parts.log.warn("executor.not_taken", { intentId: intent, errorCode: problem });
  return undefined;
}

// Everything that can refuse runs before the move to `executing`: an intent that stays
// `confirmed` signed nothing, and its owner can still cancel it.
async function takeIn(
  run: ExecutionRun,
  slot: WalletSlot,
  intent: Id<"int">,
): Promise<Taken | undefined> {
  const { parts, plan, signal } = run;
  const snapshot = await parts.stored.snapshot(intent, { signal });
  if (snapshot?.record.state !== "confirmed") {
    return notTaken(run, intent, "not_confirmed");
  }
  const check = await checkForQueue(snapshot, { parts, chain: plan.chain }, signal);
  const first = await prepareStep(run, slot, { index: 0, draft: plan.steps[0] });
  if (!first.ok) {
    return notTaken(run, intent, first.error);
  }
  if (check.isAuto && first.value.prepared.isAboveFeeCap) {
    return notTaken(run, intent, "over_fee_cap");
  }
  if (check.terms === undefined) {
    return notTaken(run, intent, "no_authorization");
  }
  const executing = await moveIntent(run, snapshot, { type: "queue_took", ...check.facts });
  if (executing === undefined) {
    return undefined;
  }
  parts.log.info("executor.took", { intentId: intent });
  return { snapshot: executing, terms: check.terms, isAuto: check.isAuto, first: first.value };
}

// A step no stuck rule can move leaves the intent `executing`, handed over at this seam.
function stopStep(run: ExecutionRun, taken: Taken, problem: string): undefined {
  const intentId = taken.snapshot.record.id;
  run.parts.log.warn("executor.step_stopped", { intentId, errorCode: problem });
  return undefined;
}

// A step that will never land ends the intent: its transaction reverted, its cancel landed, or
// every relay dropped it.
async function endLanded(
  run: ExecutionRun,
  taken: Taken,
  ended: {
    readonly outcome: Exclude<Watched["outcome"], "included" | "stuck">;
    readonly index: number;
  },
): Promise<undefined> {
  if (ended.outcome === "dropped") {
    return endDropped(run, taken.snapshot, ended.index);
  }
  const type = ended.outcome === "cancelled" ? "step_cancelled" : "step_reverted";
  await moveIntent(run, taken.snapshot, { type });
  return undefined;
}

// A step that cannot be signed, or whose signature cannot be stored, sends nothing and never
// will: the intent ends (decision 0109).
async function endStep(
  run: ExecutionRun,
  taken: Taken,
  step: { readonly index: number; readonly problem: string },
): Promise<undefined> {
  const intentId = taken.snapshot.record.id;
  run.parts.log.warn("executor.step_stopped", { intentId, errorCode: step.problem });
  return endUnsent(run, taken.snapshot, step.index);
}

async function readyStep(
  run: ExecutionRun,
  slot: WalletSlot,
  step: { readonly taken: Taken; readonly index: number; readonly draft: TxDraft },
): Promise<Result<PreparedStep, "would_fail">> {
  return step.index === 0 ? ok(step.taken.first) : prepareStep(run, slot, step);
}

// Each step in turn: prepare, sign, store, send, watch until a block holds it. A later step is
// prepared on the state the step before it left, and never sent after a revert.
async function runFrom(
  run: ExecutionRun,
  slot: WalletSlot,
  step: {
    readonly taken: Taken;
    readonly index: number;
    readonly done: readonly TransactionRecord[];
  },
): Promise<IncludedSteps | undefined> {
  const { taken, index, done } = step;
  const { snapshot } = taken;
  const draft = run.plan.steps[index];
  if (draft === undefined) {
    const included = await moveIntent(run, snapshot, { type: "steps_included" });
    return included === undefined ? undefined : { included, steps: done };
  }
  const ready = await readyStep(run, slot, { taken, index, draft });
  if (!ready.ok || (taken.isAuto && ready.value.prepared.isAboveFeeCap)) {
    return endStep(run, taken, { index, problem: ready.ok ? "over_fee_cap" : ready.error });
  }
  const stored = await signAndStore(run, slot, {
    record: snapshot.record,
    terms: taken.terms,
    ready: ready.value,
  });
  if (!stored.ok) {
    return endStep(run, taken, { index, problem: stored.error });
  }
  const rules = stuckRulesOf(run, { slot, terms: taken.terms });
  const intent = snapshot.record;
  const watched = await sendAndWatch(run, { intent, transaction: stored.value, rivals: [], rules });
  if (watched.outcome === "stuck") {
    return stopStep(run, taken, watched.problem);
  }
  if (watched.outcome !== "included") {
    return endLanded(run, taken, { outcome: watched.outcome, index });
  }
  return runFrom(run, slot, { taken, index: index + 1, done: [...done, watched.transaction] });
}

/**
 * The work of one confirmed intent on its wallet's queue (ARCHITECTURE.md section 7, step 8): the
 * `queue_took` check, then each step signed, stored before any send, sent to the relays and
 * watched until a block holds it. It answers the included steps once every step is in a block,
 * so the slot frees the wallet before finality, and `undefined` when the run stopped. A step that
 * cannot be signed or stored ends the intent (decision 0109). A stuck step is sent again, sped up
 * or cancelled at its nonce (spec 6, section 6); a landed cancel ends the intent `failed_onchain`
 * with `stuck_cancelled`, and a step no rule can move leaves it `executing`.
 */
export async function executeInSlot(
  run: ExecutionRun,
  slot: WalletSlot,
  intent: Id<"int">,
): Promise<IncludedSteps | undefined> {
  const taken = await takeIn(run, slot, intent);
  return taken === undefined ? undefined : runFrom(run, slot, { taken, index: 0, done: [] });
}
