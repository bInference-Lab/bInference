import { err, ok, type Result } from "@binference/core";
import { isFillAuthorization } from "./authorization.js";
import { type AutoModeFacts, checkAutoMode } from "./auto-mode.js";
import { cardExpiresAt } from "./card-rules.js";
import type { FillCheck } from "./intent-trigger.js";
import type { GuardInput, IntentChange, TransitionProblem } from "./transition-guard.js";

type Input = GuardInput<"authorization_checked">;

// A fill carries its order or rule from the start; any other intent meets the auto test here.
function autoModeFacts({ status, trigger }: Input): AutoModeFacts | undefined {
  return status.authorizedBy === undefined && trigger.check.by === "auto_mode"
    ? trigger.check.facts
    : undefined;
}

// The fill's own check, when the intent is a fill and the check is a fill's.
function fillCheckOf({ status, trigger }: Input): FillCheck | undefined {
  const fill = status.authorizedBy;
  const { check } = trigger;
  return fill !== undefined && isFillAuthorization(fill) && check.by === "fill" ? check : undefined;
}

function confirmFill(input: Input): Result<IntentChange, TransitionProblem> {
  const check = fillCheckOf(input);
  if (check === undefined) {
    return err("authorization_mismatch");
  }
  return check.breach === undefined ? ok({}) : err("fill_invalid");
}

/**
 * `simulated` to `confirmed`: a fill whose auto order or webhook rule holds, or an intent that
 * passes the auto test, which then records the auto mode as its authorization.
 */
export function authorizeIntent(input: Input): Result<IntentChange, TransitionProblem> {
  const facts = autoModeFacts(input);
  if (facts === undefined) {
    return confirmFill(input);
  }
  const auto = checkAutoMode(input.status, facts);
  return auto.ok ? ok({ authorizedBy: auto.value }) : err("auto_mode_refused");
}

/**
 * `simulated` to `failed_check`: a fill whose order or rule no longer holds, or that would break
 * one of its bounds, ends with the first bound it breaks as its reason (spec 6, section 5).
 */
export function breakFill(input: Input): Result<IntentChange, TransitionProblem> {
  const check = fillCheckOf(input);
  if (check === undefined) {
    return err("authorization_mismatch");
  }
  return check.breach === undefined ? err("fill_holds") : ok({ reason: check.breach });
}

function firstCard({ status, trigger, nowMs }: Input): IntentChange {
  return {
    card: {
      version: 1,
      openedAtMs: nowMs,
      expiresAtMs: cardExpiresAt(status.kind, nowMs, trigger.cards),
    },
  };
}

/** `simulated` to `awaiting_confirmation`: an intent that is not a fill and fails the auto test. */
export function openCard(input: Input): Result<IntentChange, TransitionProblem> {
  const facts = autoModeFacts(input);
  if (facts === undefined) {
    return err("authorization_mismatch");
  }
  return checkAutoMode(input.status, facts).ok ? err("needs_no_card") : ok(firstCard(input));
}
