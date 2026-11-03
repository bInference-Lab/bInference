import type { Id } from "@binference/core";
import type { AlertFillRecord, AlertFillWrite } from "../webhooks/alert-fill-record.js";
import { constraintFault } from "./memory-call.js";
import type { MemoryEventRow } from "./memory-webhook-alert-store.js";

/** What became of an accepted alert's fill, as the memory rule store keeps it by row. */
export type Ended = Pick<
  AlertFillRecord,
  "outcome" | "reason" | "intentId" | "notices" | "announcedAtMs"
>;

/** An accepted alert's row with what became of its fill, as `WebhookRuleStore.alert` reads it. */
export function alertOf(row: MemoryEventRow, end: Ended | undefined): AlertFillRecord {
  const { draft } = row;
  return structuredClone({
    event: row.id,
    ruleId: draft.rule,
    ...(draft.alertId === undefined ? {} : { alertId: draft.alertId }),
    receivedAtMs: draft.receivedAtMs,
    wasEngineLocked: draft.isEngineLocked === true,
    ...end,
  });
}

/** What carries a rule fill's write on its alert: its intent's move, or its late landing. */
export interface MemoryFillCarrier {
  readonly intent: Id<"int">;
  readonly isLanding: boolean;
}

/**
 * Throws `store.constraint` for a rule fill's write that names another intent than the one that
 * carries it, or a fill that skips its rule's count while the rule was not deleted (decision
 * 0342).
 */
export function assertCarried(
  write: AlertFillWrite,
  carried: { readonly by: MemoryFillCarrier; readonly isRuleDeleted: boolean },
): void {
  const counts = write.outcome === "skipped" || write.move !== undefined || carried.isRuleDeleted;
  if (write.intentId !== carried.by.intent || !counts) {
    throw constraintFault("a rule fill's write names its intent and counts a fill on its rule");
  }
}

/** Whether an alert ended `filled` by this intent, which then holds no agent's line. */
export function isFilledBy(
  ends: Iterable<Pick<AlertFillRecord, "outcome" | "intentId">>,
  intent: Id<"int">,
): boolean {
  return [...ends].some((end) => end.outcome === "filled" && end.intentId === intent);
}

/**
 * Whether a late landing turns the `stuck_dropped` skip its own drop wrote into the fill it was
 * (decision 0342).
 */
export function isLandingOverDrop(
  end: Pick<AlertFillRecord, "outcome" | "reason" | "intentId"> | undefined,
  write: AlertFillWrite,
  by: MemoryFillCarrier,
): boolean {
  return (
    by.isLanding &&
    write.outcome === "filled" &&
    end?.outcome === "skipped" &&
    end.reason === "stuck_dropped" &&
    end.intentId === by.intent
  );
}
