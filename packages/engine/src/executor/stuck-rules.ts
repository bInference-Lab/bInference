import type { StepReplacement, TxDraft } from "@binference/chain";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import { type ExecutionRun, readSafely } from "./executor-run.js";
import type { SigningTerms } from "./queue-check.js";
import { sendOnce, signAndStore } from "./run-step.js";
import type { StuckAt, StuckMove, StuckRules } from "./send-and-watch.js";
import { finalFate, readFate } from "./step-fate.js";
import { launchTermsNow, termsNow } from "./terms-now.js";

/** What signs a stuck step's replacement: the slot that holds its wallet, and the intent's terms. */
interface StuckSigning {
  readonly slot: WalletSlot;
  readonly terms: SigningTerms;
}

/** A stuck step at a rule, with its draft from the intent's plan. */
interface StuckStep {
  readonly at: StuckAt;
  readonly draft: TxDraft;
}

const waiting: StuckMove = { kind: "waiting" };

function stopped(problem: string): StuckMove {
  return { kind: "stopped", problem };
}

// Simulated again: the step's draft prepared on the latest state, which runs it there. A node
// that cannot answer leaves the question open.
async function isStillValid(run: ExecutionRun, stuck: StuckStep): Promise<boolean | undefined> {
  const { plan, signal } = run;
  const { draft, at } = stuck;
  const { nonce } = at.transaction;
  const prepared = await readSafely(run, async () =>
    plan.sending.preparer.prepare({ draft, nonce }, { signal }),
  );
  return prepared?.ok;
}

// The rule's move: a cancel stays a cancel; a step that fails now is cancelled; one still valid
// gets its bytes again at the first rule and a speed-up at the second.
async function moveOf(
  run: ExecutionRun,
  stuck: StuckStep,
): Promise<StepReplacement["kind"] | "resend" | undefined> {
  const { at } = stuck;
  const isValid = at.transaction.replaces?.kind === "cancel" || (await isStillValid(run, stuck));
  if (isValid === undefined) {
    return undefined;
  }
  if (!isValid) {
    return "cancel";
  }
  if (at.rule === "resend") {
    return "resend";
  }
  return at.transaction.replaces?.kind === "cancel" ? "cancel" : "speedUp";
}

// The terms a replacement signs with, read again right before it: what authorizes it now and, for
// a launch wallet's speed-up, its launch's contracts, while the read fails a wait, and once the
// launch moved a cancel instead (decision 0218).
async function replacementTerms(
  run: ExecutionRun,
  signing: StuckSigning,
  move: StuckStep & { readonly kind: StepReplacement["kind"] },
): Promise<SigningTerms | StuckMove> {
  const { intent } = move.at;
  const authorized = await termsNow(run, signing.terms, { record: intent, kind: move.kind });
  if (authorized === undefined) {
    return stopped("authorization_lapsed");
  }
  if (move.kind !== "speedUp") {
    return authorized;
  }
  const launched = await launchTermsNow(run, authorized, intent);
  if (launched.ok) {
    return launched.value;
  }
  return launched.error === "launch_moved"
    ? replace(run, signing, { ...move, kind: "cancel" })
    : waiting;
}

// A replacement made, signed and stored at the stuck transaction's nonce, then sent once. A
// speed-up whose call fails by now becomes a cancel; a fee above the network fee cap, which no
// tap showed the owner, is never paid (decision 0102).
async function replace(
  run: ExecutionRun,
  signing: StuckSigning,
  move: StuckStep & { readonly kind: StepReplacement["kind"] },
): Promise<StuckMove> {
  const { plan, parts, signal } = run;
  const { at, draft, kind } = move;
  const { transaction, intent } = at;
  const replaced = { chain: plan.chain.ref, raw: transaction.raw };
  const request = { kind, from: transaction.account, replaced };
  const prepared = await readSafely(run, async () =>
    plan.sending.preparer.replace(request, { signal }),
  );
  if (prepared === undefined) {
    return waiting;
  }
  if (!prepared.ok) {
    return kind === "speedUp"
      ? replace(run, signing, { ...move, kind: "cancel" })
      : stopped("would_fail");
  }
  if (prepared.value.isAboveFeeCap) {
    return stopped("over_fee_cap");
  }
  const terms = await replacementTerms(run, signing, move);
  if (!("allowed" in terms)) {
    return terms;
  }
  // Once the engine begins to stop, no replacement is signed; the watch's next wait ends it.
  if (run.stopping.aborted) {
    return waiting;
  }
  const { step, nonce } = transaction;
  const ready = { index: step, draft, nonce, prepared: prepared.value };
  const replacing = { transaction, replaces: prepared.value.replaces };
  const stored = await signAndStore(run, signing.slot, { record: intent, terms, ready, replacing });
  if (!stored.ok) {
    return stopped(stored.error);
  }
  parts.log.warn(kind === "cancel" ? "executor.stuck_cancel" : "executor.stuck_speed_up", {
    intentId: intent.id,
    chain: plan.chain.ref,
  });
  return { kind: "replaced", ...(await sendOnce(run, intent, stored.value)) };
}

async function moveStuck(
  run: ExecutionRun,
  signing: StuckSigning,
  at: StuckAt,
): Promise<StuckMove> {
  const read = await readFate(run, at);
  // A used nonce waits for its block to be final before it is another's.
  const fate = read?.kind === "taken" ? await finalFate(run, at) : read;
  if (fate === undefined) {
    return waiting;
  }
  if (fate.kind === "found") {
    return { kind: "landed", transaction: fate.transaction, receipt: fate.receipt };
  }
  const draft = run.plan.steps[at.transaction.step];
  if (fate.kind === "taken" || draft === undefined) {
    return stopped(fate.kind === "taken" ? "nonce_used" : "no_step");
  }
  const kind = await moveOf(run, { at, draft });
  if (kind === undefined) {
    return waiting;
  }
  if (kind !== "resend") {
    return replace(run, signing, { at, draft, kind });
  }
  run.parts.log.warn("executor.stuck_resent", {
    intentId: at.intent.id,
    chain: run.plan.chain.ref,
  });
  return { kind: "resent", ...(await sendOnce(run, at.intent, at.transaction)) };
}

/**
 * The stuck rules of spec 6, section 6, for a step the wallet's slot holds. A step's nonce
 * another transaction used stops them once a final block holds it and the step's receipts, read
 * again, show none of its own. Otherwise the step is simulated again: still valid, it
 * gets the same bytes again at the first rule and a speed-up at the second, the same call at its
 * nonce for at least 10% more; no longer valid, it gets a cancel, a 0-value transfer to the
 * wallet itself at its nonce for at least 10% more. Each replacement is a new signature for the
 * same authorization, read again before it (`termsNow`), which the signer checks again; a
 * launch wallet's speed-up reads its launch's contracts again too, waits while they cannot be
 * read and becomes a cancel once the launch moved (decision 0218); the
 * transaction it replaces becomes `superseded`. A replacement custody refuses, the store cannot
 * keep, that would fail, whose fee passes the network fee cap, or that nothing authorizes any more
 * (a speed-up after the confirmation expired, an auto grant after a switch to manual) stops them,
 * and the step is handed over.
 */
export function stuckRulesOf(run: ExecutionRun, signing: StuckSigning): StuckRules {
  return async (at) => moveStuck(run, signing, at);
}
