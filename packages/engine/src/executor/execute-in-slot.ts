import type { TxDraft } from "@binference/chain";
import { type Err, err, type Id, ok, type Result } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { LaunchReadFailure } from "../intents/intent-reason.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import { endDropped } from "./end-dropped.js";
import { endFailedStep } from "./end-failed-step.js";
import { endRefusedFill } from "./end-refused-fill.js";
import { endUnsent } from "./end-unsent.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { takeIdentity } from "./identity-queue-check.js";
import { takeSendName } from "./name-queue-check.js";
import { checkForQueue, type QueueCheck, type SigningTerms } from "./queue-check.js";
import { resetApproval } from "./reset-approval.js";
import { type PreparedStep, prepareStep, type SignStop, signAndStore } from "./run-step.js";
import { sendAndWatch, type Watched } from "./send-and-watch.js";
import type { ServiceRefusal } from "./service-refusal.js";
import { takeStake } from "./stake-queue-check.js";
import { stuckRulesOf } from "./stuck-rules.js";
import { launchTermsNow, termsNow } from "./terms-now.js";
import type { DroppedStep } from "./watch-dropped.js";

/** Every step of an intent in a block, with the intent moved to `included`. */
export interface IncludedSteps {
  readonly included: IntentSnapshot;
  readonly steps: readonly TransactionRecord[];
}

/** An intent the queue took, moved to `executing`, with what signs its steps. */
interface Taken {
  readonly snapshot: IntentSnapshot;
  readonly terms: SigningTerms;
  /** Its first step as the queue prepared it; absent when it goes on from a later step. */
  readonly first?: PreparedStep;
}

/**
 * What became of a confirmed intent on its wallet's slot: its steps all in blocks, a step dropped
 * whose transactions are watched off the queue, a {@link Retry} when it stays `confirmed` for a
 * reason that may pass before its authorization runs out (a fee per gas above the network fee
 * cap, or no node that answered while its first step was prepared), or nothing more to do here
 * (`undefined`).
 */
export type SlotOutcome = IncludedSteps | DroppedStep | Retry | undefined;

/**
 * Why the queue left a confirmed intent to try again a block later: its fee, a first step no node
 * prepared, or a bridge its checks hold (decisions 0318 and 0319).
 */
type Retry = "over_fee_cap" | "unprepared" | "held";

function notTaken(run: ExecutionRun, intent: Id<"int">, problem: string): undefined {
  run.parts.log.warn("executor.not_taken", { intentId: intent, errorCode: problem });
  return undefined;
}

/** The owner's notice of a curve trade whose launch the queue could not read (decision 0218). */
const launchUnsentNoticeKey = "notice.launchUnsent";

// A launch wallet's curve trade whose launch cannot be read ends before anything signs, with its
// own reason and notice: the signer is asked only with the launch's contracts in hand.
async function endUnread(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  reason: LaunchReadFailure,
): Promise<undefined> {
  const ended = await moveIntent(run, snapshot, { type: "launch_read_failed", reason });
  if (ended === undefined) {
    return undefined;
  }
  const { id, agentId } = ended.record;
  run.parts.log.warn("executor.launch_unread", { intentId: id, errorCode: reason });
  const notice = { key: launchUnsentNoticeKey, agent: agentId, intent: id, values: { reason } };
  run.parts.publish(noticePush(notice));
  return undefined;
}

// The queue's check of a confirmed intent with what signs it; `undefined` when nothing does. A
// fill it refuses ends at once (decision 0211), a launch wallet's curve trade whose launch cannot
// be read ends with its own reason before anything signs (decision 0218), and a send by name signs
// only while its name still points to its card's address, waiting a block while the name cannot be
// read (decision 0308).
async function checkedForQueue(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
): Promise<(QueueCheck & { readonly terms: SigningTerms }) | Retry | undefined> {
  const intent = snapshot.record.id;
  const check = await checkForQueue(
    snapshot,
    { parts: run.parts, chain: run.plan.chain },
    run.signal,
  );
  if (check.refusal !== undefined) {
    await endRefusedFill(run, { snapshot, reason: check.refusal });
    return notTaken(run, intent, check.refusal);
  }
  // A bridge its checks hold stays confirmed, and the queue reads it again a block later.
  if (snapshot.record.kind === "bridge" && !check.facts.hasPolicyPassed) {
    run.parts.log.warn("executor.bridge_held", { intentId: intent });
    return "held";
  }
  const { terms } = check;
  if (terms === undefined) {
    return notTaken(run, intent, "no_authorization");
  }
  if (check.launchFailure !== undefined) {
    return endUnread(run, snapshot, check.launchFailure);
  }
  const named = await takeSendName(run, snapshot);
  const staked = named === "go" ? await takeStake(run, snapshot) : named;
  const taken = staked === "go" ? await takeIdentity(run, snapshot) : staked;
  if (taken === "go") {
    return { ...check, terms };
  }
  return taken === "unread" ? "unprepared" : undefined;
}

// The first step, prepared before the move to `executing`: one whose fee per gas is above the
// network fee cap, or that no node could prepare, waits for a later block; one that would fail
// ends the take.
async function firstStepOf(
  run: ExecutionRun,
  slot: WalletSlot,
  intent: Id<"int">,
): Promise<PreparedStep | Retry | undefined> {
  const first = await prepareStep(run, slot, { index: 0, draft: run.plan.steps[0] });
  if (!first.ok || first.value.prepared.isAboveFeeCap) {
    const problem = first.ok ? "over_fee_cap" : first.error;
    notTaken(run, intent, problem);
    return problem === "would_fail" ? undefined : problem;
  }
  return first.value;
}

// Everything that can refuse runs before the move to `executing`: an intent that stays
// `confirmed` signed nothing, and its owner can still cancel it. No card shows a fee per gas, so
// no step pays one above the network fee cap, tapped or not (decision 0102).
async function takeIn(
  run: ExecutionRun,
  slot: WalletSlot,
  intent: Id<"int">,
): Promise<Taken | Retry | undefined> {
  const { parts, signal } = run;
  const snapshot = await parts.stored.snapshot(intent, { signal });
  if (snapshot?.record.state !== "confirmed") {
    return notTaken(run, intent, "not_confirmed");
  }
  const check = await checkedForQueue(run, snapshot);
  if (check === undefined || typeof check === "string") {
    return check;
  }
  const first = await firstStepOf(run, slot, intent);
  if (first === undefined || typeof first === "string") {
    return first;
  }
  // An intent the engine's stop meets here stays `confirmed`, with nothing signed.
  if (run.stopping.aborted) {
    return notTaken(run, intent, "stopping");
  }
  const executing = await moveIntent(run, snapshot, { type: "queue_took", ...check.facts });
  if (executing === undefined) {
    return undefined;
  }
  parts.log.info("executor.took", { intentId: intent });
  return { snapshot: executing, terms: check.terms, first };
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
    readonly transaction: TransactionRecord;
  },
): Promise<DroppedStep | undefined> {
  if (ended.outcome === "dropped") {
    return endDropped(run, taken.snapshot, ended.transaction);
  }
  const isCancel = ended.outcome === "cancelled";
  await endFailedStep(run, taken.snapshot, { isCancel, step: ended.transaction.step });
  return undefined;
}

// A step that cannot be signed, or whose signature cannot be stored, sends nothing and never
// will: the intent ends (decision 0109), with a signer service's refusal as its reason (decision
// 0427).
async function endStep(
  run: ExecutionRun,
  taken: Taken,
  step: { readonly index: number; readonly problem: string; readonly refusal?: ServiceRefusal },
): Promise<undefined> {
  const intentId = taken.snapshot.record.id;
  run.parts.log.warn("executor.step_stopped", { intentId, errorCode: step.problem });
  const unsent = step.refusal === undefined ? {} : { refusal: step.refusal };
  return endUnsent(run, taken.snapshot, { index: step.index, ...unsent });
}

// A step that stopped before it was stored, with the signer service's refusal when that is why.
function unsentOf(
  index: number,
  stopped: Err<SignStop | LaunchReadFailure | "authorization_lapsed"> | ServiceRefusal,
): { readonly index: number; readonly problem: string; readonly refusal?: ServiceRefusal } {
  const isRefusal = stopped.error === "over_sums" || stopped.error === "locked";
  return { index, problem: stopped.error, ...(isRefusal ? { refusal: stopped } : {}) };
}

// Once the engine begins to stop, no step is signed: the intent ends as one never signed.
async function readyStep(
  run: ExecutionRun,
  slot: WalletSlot,
  step: { readonly taken: Taken; readonly index: number; readonly draft: TxDraft },
): Promise<Result<PreparedStep, "would_fail" | "unprepared" | "stopping">> {
  if (run.stopping.aborted) {
    return err("stopping");
  }
  const { first } = step.taken;
  return step.index === 0 && first !== undefined ? ok(first) : prepareStep(run, slot, step);
}

// The terms read again right before a step signs: what authorizes it now and, past the first
// step, a launch wallet's launch contracts read again (decision 0218); then the signature, stored.
// A fill whose authorization ran out resets the approval its landed steps left (decision 0211).
async function signStep(
  run: ExecutionRun,
  slot: WalletSlot,
  step: { readonly taken: Taken; readonly index: number; readonly ready: PreparedStep },
): Promise<
  Result<TransactionRecord, SignStop | LaunchReadFailure | "authorization_lapsed"> | ServiceRefusal
> {
  const { taken, index, ready } = step;
  const { record } = taken.snapshot;
  const terms = await termsNow(run, taken.terms, { record, kind: "step", index });
  if (terms === undefined) {
    // A fill's trade that cannot finish takes back the approval its landed steps left.
    await resetApproval(run, slot, { snapshot: taken.snapshot, terms: taken.terms, index });
    return err("authorization_lapsed");
  }
  const launched = index === 0 ? ok(terms) : await launchTermsNow(run, terms, record);
  return launched.ok ? signAndStore(run, slot, { record, terms: launched.value, ready }) : launched;
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
): Promise<IncludedSteps | DroppedStep | undefined> {
  const { taken, index, done } = step;
  const { snapshot } = taken;
  const draft = run.plan.steps[index];
  if (draft === undefined) {
    const included = await moveIntent(run, snapshot, { type: "steps_included" });
    return included === undefined ? undefined : { included, steps: done };
  }
  const ready = await readyStep(run, slot, { taken, index, draft });
  if (!ready.ok || ready.value.prepared.isAboveFeeCap) {
    return endStep(run, taken, { index, problem: ready.ok ? "over_fee_cap" : ready.error });
  }
  const stored = await signStep(run, slot, { taken, index, ready: ready.value });
  if (!stored.ok) {
    return endStep(run, taken, unsentOf(index, stored));
  }
  const rules = stuckRulesOf(run, { slot, terms: taken.terms });
  const intent = snapshot.record;
  const watched = await sendAndWatch(run, { intent, transaction: stored.value, rivals: [], rules });
  if (watched.outcome === "stuck") {
    return stopStep(run, taken, watched.problem);
  }
  if (watched.outcome !== "included") {
    return endLanded(run, taken, { outcome: watched.outcome, transaction: watched.transaction });
  }
  return runFrom(run, slot, { taken, index: index + 1, done: [...done, watched.transaction] });
}

/**
 * Goes on with a live fill's steps from `index` after a restart (decision 0211), on its wallet's
 * slot, as its first run would have: each step signed under the fill grant while it still holds,
 * and the approval its landed steps left reset to 0 once it does not.
 */
export async function finishFill(
  run: ExecutionRun,
  slot: WalletSlot,
  from: {
    readonly snapshot: IntentSnapshot;
    readonly terms: SigningTerms;
    readonly index: number;
    readonly done: readonly TransactionRecord[];
  },
): Promise<IncludedSteps | DroppedStep | undefined> {
  const { snapshot, terms, index, done } = from;
  return runFrom(run, slot, { taken: { snapshot, terms }, index, done });
}

/**
 * The work of one confirmed intent on its wallet's queue (ARCHITECTURE.md section 7, step 8): the
 * `queue_took` check, which ends a launch wallet's curve trade whose launch it cannot read with
 * `launch_unread` or `launch_moved` and `notice.launchUnsent` (decision 0218) and a send by name
 * whose name moved with `name_moved` and `notice.nameMoved`, and retries one whose name cannot be
 * read (decision 0308), then each step signed, stored before any send, sent to the relays and
 * watched until a block holds it. It answers the included steps once every step is in a block,
 * so the slot frees the wallet before finality, a retry when the first step's fee per gas is
 * above the network fee cap or no node answered as it was prepared, which leaves the intent
 * `confirmed`, and `undefined` when the run stopped. A step that cannot be signed or stored, or whose fee per gas is above the cap, ends the
 * intent (decision 0109). A stuck step is sent again, sped up
 * or cancelled at its nonce (spec 6, section 6); a landed cancel ends the intent `failed_onchain`
 * with `stuck_cancelled`, and a step no rule can move leaves it `executing`. Once the engine
 * begins to stop, a step being signed or sent goes on to its first send, and no other step is
 * signed.
 */
export async function executeInSlot(
  run: ExecutionRun,
  slot: WalletSlot,
  intent: Id<"int">,
): Promise<SlotOutcome> {
  const taken = await takeIn(run, slot, intent);
  return taken === undefined || typeof taken === "string"
    ? taken
    : runFrom(run, slot, { taken, index: 0, done: [] });
}
