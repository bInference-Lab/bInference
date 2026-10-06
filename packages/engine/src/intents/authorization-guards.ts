import { err, ok, type Result } from "@binference/core";
import { cardExpiresAt } from "./card-rules.js";
import type { GuardInput, IntentChange, TransitionProblem } from "./transition-guard.js";

type Input = GuardInput<"authorization_checked">;

/** `simulated` to `confirmed`: a fill whose auto order or webhook rule holds. */
export function authorizeIntent({
  status,
  trigger,
}: Input): Result<IntentChange, TransitionProblem> {
  if (status.authorizedBy === undefined || trigger.check.by !== "fill") {
    return err("authorization_mismatch");
  }
  return trigger.check.isValid ? ok({}) : err("fill_invalid");
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

/** `simulated` to `awaiting_confirmation`: an intent that is not a fill waits for the owner's tap. */
export function openCard(input: Input): Result<IntentChange, TransitionProblem> {
  const isManual = input.status.authorizedBy === undefined && input.trigger.check.by === "manual";
  return isManual ? ok(firstCard(input)) : err("authorization_mismatch");
}
