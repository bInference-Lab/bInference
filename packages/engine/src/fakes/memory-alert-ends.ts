import type { Id } from "@binference/core";
import { inFlightStates, ruleFillOfAuthorization } from "../intents/fills-in-flight.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type {
  AlertAnnouncement,
  AlertFillRecord,
  AlertFillWrite,
} from "../webhooks/alert-fill-record.js";
import { constraintFault } from "./memory-call.js";
import type { MemoryEventRow } from "./memory-webhook-alert-store.js";

/** The accepted alerts whose notices were never announced, in row order, at most `limit`. */
export function unannouncedOf(
  rows: readonly MemoryEventRow[],
  ended: ReadonlyMap<number, Ended>,
  limit: number,
): readonly AlertFillRecord[] {
  return rows
    .filter((row) => {
      const end = ended.get(row.id);
      return end?.notices !== undefined && end.announcedAtMs === undefined;
    })
    .slice(0, limit)
    .map((row) => alertOf(row, ended.get(row.id)));
}

/** Marks the notices of these alerts announced at `atMs`, keeping an earlier time. */
export function markAnnouncedIn(
  ended: Map<number, Ended>,
  { events, atMs }: AlertAnnouncement,
): void {
  events.forEach((event) => {
    const end = ended.get(event);
    if (end?.notices !== undefined && end.announcedAtMs === undefined) {
      ended.set(event, { ...end, announcedAtMs: atMs });
    }
  });
}

/**
 * Throws `store.constraint` for an alert's end written alone that is neither a skip nor the count
 * of a live fill its reconciliation could not value, at `finalized`, on its rule or a deleted one
 * (decision 0342).
 */
export function assertEndsAlone(
  write: AlertFillWrite,
  facts: {
    readonly intent?: Pick<IntentRecord, "isPaper" | "state" | "authorizedBy">;
    readonly rule?: Id<"whr">;
    readonly isRuleDeleted: boolean;
  },
): void {
  const { intent } = facts;
  const isUnvalued =
    intent !== undefined &&
    isOwnFill(intent, { rule: facts.rule, event: write.event }) &&
    !intent.isPaper &&
    intent.state === "finalized" &&
    (write.move !== undefined || facts.isRuleDeleted);
  if (write.outcome !== "skipped" && !isUnvalued) {
    throw constraintFault("a fill ends its alert with its intent's move");
  }
}

// Whether an intent's stored authorization is this rule's fill of this alert row.
function isOwnFill(
  intent: Pick<IntentRecord, "authorizedBy">,
  alert: { readonly rule: Id<"whr"> | undefined; readonly event: number },
): boolean {
  const fill = ruleFillOfAuthorization(intent.authorizedBy);
  return fill !== undefined && fill.rule === alert.rule && fill.event === alert.event;
}

/**
 * Whether a skip would end an alert whose live fill the executor holds, for any but that fill
 * itself: only the fill's own move may end the alert (decision 0342).
 */
export function isHeldFromSkip(
  intents: readonly IntentRecord[],
  end: { readonly write: AlertFillWrite; readonly rule: Id<"whr"> },
): boolean {
  const { write, rule } = end;
  const held = intents.find(
    (intent) =>
      !intent.isPaper &&
      intent.proposer === "engine" &&
      inFlightStates.includes(intent.state) &&
      isOwnFill(intent, { rule, event: write.event }),
  );
  return write.outcome === "skipped" && held !== undefined && held.id !== write.intentId;
}

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
