import { err, ok, type Result } from "@binference/core";
import { isFillAuthorization } from "./authorization.js";
import { type AutoModeFacts, checkAutoMode } from "./auto-mode.js";
import { cardExpiresAt } from "./card-rules.js";
import type { GuardInput, IntentChange, TransitionProblem } from "./transition-guard.js";

type Input = GuardInput<"authorization_checked">;

// A fill carries its order or rule from the start; any other intent meets the auto test here.
function autoModeFacts({ status, trigger }: Input): AutoModeFacts | undefined {
  return status.authorizedBy === undefined && trigger.check.by === "auto_mode"
    ? trigger.check.facts
    : undefined;
}

function confirmFill({ status, trigger }: Input): Result<IntentChange, TransitionProblem> {
  const fill = status.authorizedBy;
  if (fill === undefined || !isFillAuthorization(fill) || trigger.check.by !== "fill") {
    return err("authorization_mismatch");
  }
  return trigger.check.isValid ? ok({}) : err("fill_invalid");
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
