import { err, ok, type Result } from "@binference/core";
import type { IntentStatus } from "./intent-status.js";
import type { QueueFacts } from "./intent-trigger.js";
import type {
  GuardInput,
  IntentChange,
  TransitionGuard,
  TransitionProblem,
} from "./transition-guard.js";

/** How long a bridge waits for delivery after its source transaction is final (decision 0067). */
export const bridgeDeliveryWaitMs: number = 2 * 60 * 60 * 1000;

/**
 * Any state before `executing` to `cancelled`: nothing is signed yet. A freeze spares a rescue,
 * which works while frozen.
 */
export function cancelIntent({
  status,
  trigger,
}: GuardInput<"cancel_requested">): Result<IntentChange, TransitionProblem> {
  if (trigger.hasSignedStep) {
    return err("already_signed");
  }
  if (trigger.cause === "freeze" && status.kind === "rescue") {
    return err("rescue_outlasts_freeze");
  }
  return ok({ cancelCause: trigger.cause });
}

/** `confirmed` to `paper_filled`: a paper intent fills at its confirmed quote. */
export function fillOnPaper({
  status,
}: GuardInput<"paper_fill_recorded">): Result<IntentChange, TransitionProblem> {
  return status.isPaper ? ok({}) : err("live_intent");
}

// A tapped intent needs the confirmation of its current card version, unexpired; a fill or an
// auto-mode intent needs its authorization to still hold.
function approvalProblem(
  status: IntentStatus,
  facts: QueueFacts,
  nowMs: number,
): TransitionProblem | undefined {
  if (status.authorizedBy !== undefined) {
    return facts.isAuthorizationValid === true ? undefined : "authorization_lapsed";
  }
  const { confirmation } = facts;
  if (confirmation === undefined || confirmation.cardVersion !== status.card?.version) {
    return "no_confirmation";
  }
  return nowMs < confirmation.expiresAtMs ? undefined : "expired";
}

/**
 * `confirmed` to `executing`: the wallet queue takes a live intent whose confirmation record exists
 * and is unexpired, or whose authorization holds, and whose policy still passes.
 */
export function takeIntoQueue({
  status,
  trigger,
  nowMs,
}: GuardInput<"queue_took">): Result<IntentChange, TransitionProblem> {
  if (status.isPaper) {
    return err("paper_intent");
  }
  if (!trigger.isAgentLive) {
    return err("agent_not_live");
  }
  if (!trigger.hasPolicyPassed) {
    return err("policy_refused");
  }
  const problem = approvalProblem(status, trigger, nowMs);
  return problem === undefined ? ok({}) : err(problem);
}

/**
 * `executing` to `failed_onchain` when a step reverts or a stuck step is cancelled. A rescue
 * retries a failed step instead and settles with every step's outcome (spec 6, section 5).
 */
export function failOnchain(
  reason: "reverted" | "stuck_cancelled",
): TransitionGuard<"step_reverted" | "step_cancelled"> {
  return ({ status }) => (status.kind === "rescue" ? err("rescue_retries") : ok({ reason }));
}

/**
 * `finalized` to `reconciled`. A bridge also waits for the bridge to report delivery, or for 2
 * hours, after which the caller marks the delivery unknown and sends a notice.
 */
export function reconcileFills({
  status,
  trigger,
  nowMs,
}: GuardInput<"fills_reconciled">): Result<IntentChange, TransitionProblem> {
  const isWaitingForDelivery =
    status.kind === "bridge" &&
    trigger.isDeliveryReported !== true &&
    nowMs - status.changedAtMs < bridgeDeliveryWaitMs;
  return isWaitingForDelivery ? err("delivery_pending") : ok({});
}
