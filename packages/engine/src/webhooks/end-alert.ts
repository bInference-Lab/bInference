import type { Clock, Id } from "@binference/core";
import type { NoticeHour } from "../notices/notice-hour.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { type Notice, noticePush } from "../pushes/notice-push.js";
import { ruleSkippedNotice, toldWithinHour } from "./alert-fill-notices.js";
import type { AlertFillRecord, AlertFillWrite } from "./alert-fill-record.js";
import type { WebhookRuleStore } from "./ports.js";
import type { WebhookRuleMove, WebhookRuleRecord } from "./webhook-rule-record.js";

/** What ending an alert reads, writes and tells through. */
export interface AlertEndParts {
  readonly rules: WebhookRuleStore;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

/** One alert's skip: why, the intent that ended if one was stored, and whether the owner hears it. */
export interface AlertSkip {
  readonly event: number;
  readonly reason: OrderFillReason;
  readonly intentId?: Id<"int">;
  /** False for a skip the owner made, as a rotation or a delete: it is recorded and never told. */
  readonly tells: boolean;
  /** What the agent used of the rolling cap and the cap, which a skip for the cap tells. */
  readonly cap?: { readonly usedUsdMicros: bigint; readonly capUsdMicros: bigint };
}

// A skip is told once per reason in a row (decision 0336): when the rule's alert that ended before
// this one filled, or skipped for another reason.
async function isNewReason(
  parts: { readonly rules: Pick<WebhookRuleStore, "alerts"> },
  skip: AlertSkip & { readonly ruleId: Id<"whr"> },
  signal: AbortSignal,
): Promise<boolean> {
  const recent = await parts.rules.alerts({ ruleId: skip.ruleId, limit: 50 }, { signal });
  const last = recent.find(({ event, outcome }) => event !== skip.event && outcome !== undefined);
  return last?.outcome !== "skipped" || last.reason !== skip.reason;
}

/**
 * Tells the owner the notices an alert's end wrote, once, then marks them announced. A stop
 * between the two tells them again at the next run.
 */
export async function announceAlerts(
  parts: AlertEndParts,
  alerts: readonly AlertFillRecord[],
  signal: AbortSignal,
): Promise<void> {
  const due = alerts.filter(
    (alert) => alert.notices !== undefined && alert.announcedAtMs === undefined,
  );
  if (due.length === 0) {
    return;
  }
  due.forEach(({ notices }) => {
    (notices ?? []).forEach((data) => {
      parts.publish({ topic: "notice", kind: "notice/new", data });
    });
  });
  const events = due.map(({ event }) => event);
  await parts.rules.markAnnounced({ events, atMs: parts.clock.now() }, { signal });
}

/**
 * A skip's write on its alert at `atMs` and, when it tells something, on its rule's notice hour.
 * A deleted rule never moves, so it keeps no hour.
 */
export async function skipWriteOf(
  parts: { readonly rules: Pick<WebhookRuleStore, "alerts"> },
  call: {
    readonly rule: WebhookRuleRecord;
    readonly skip: AlertSkip;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<AlertFillWrite> {
  const { rule, skip, atMs, signal } = call;
  const isTold = skip.tells && (await isNewReason(parts, { ...skip, ruleId: rule.id }, signal));
  const cap = skip.cap === undefined ? {} : { cap: skip.cap };
  const notice = isTold ? ruleSkippedNotice(rule, { reason: skip.reason, ...cap }) : undefined;
  const told = toldWithinHour(rule, { notice, atMs });
  const hour = told.hour === undefined ? {} : { hour: told.hour };
  const move = skipMoveOf(rule, { ...hour, atMs });
  return {
    ...bareSkipOf(skip),
    ...(told.notices.length === 0 ? {} : { notices: told.notices }),
    ...(move === undefined ? {} : { move }),
  };
}

/**
 * A skip's write on its alert that ends its live rule `deleted` with it (decision 0342), as the
 * owner's cancel of its fill or its fifth fill failed on chain since its last fill does. The
 * notice that tells the end always goes out, past the rule's notice hour, since the rule takes no
 * more alerts. A rule deleted already keeps its end and tells nothing more.
 */
export function ruleEndingWriteOf(
  rule: WebhookRuleRecord,
  call: { readonly skip: AlertSkip; readonly atMs: number; readonly notice: Notice },
): AlertFillWrite {
  const { skip, atMs, notice } = call;
  if (rule.state === "deleted") {
    return bareSkipOf(skip);
  }
  const move = { id: rule.id, expectedVersion: rule.version, state: "deleted" as const, atMs };
  return { ...bareSkipOf(skip), notices: [noticePush(notice).data], move };
}

// The rule's move a skip writes: the notice hour it keeps; none for a deleted rule, or a skip that
// tells nothing.
function skipMoveOf(
  rule: WebhookRuleRecord,
  change: { readonly hour?: NoticeHour; readonly atMs: number },
): WebhookRuleMove | undefined {
  const { hour, atMs } = change;
  if (rule.state === "deleted" || hour === undefined) {
    return undefined;
  }
  return { id: rule.id, expectedVersion: rule.version, state: rule.state, atMs, noticeHour: hour };
}

// A skip that lost its rule's version to another write is counted again on a fresh read.
const endTries = 3;

// The skip alone, with no move of its rule: for a rule that is gone, or a last try after the
// tries before it each lost the rule's version to another write.
function bareSkipOf(skip: AlertSkip) {
  return {
    event: skip.event,
    outcome: "skipped" as const,
    reason: skip.reason,
    ...(skip.intentId === undefined ? {} : { intentId: skip.intentId }),
  };
}

/**
 * Ends an accepted alert as skipped (decisions 0336 to 0338): its reason on its row, the notice
 * the owner hears once per reason in a row, within the rule's notice hour, and that notice told.
 * A skip that lost its rule's version to another write is read and written again, and the last
 * try writes the skip alone, so every alert ends. An alert whose rule is gone ends as the skip
 * alone, and one that already ended keeps its end.
 */
export async function endAlertSkipped(
  parts: AlertEndParts,
  call: { readonly ruleId: Id<"whr">; readonly skip: AlertSkip; readonly signal: AbortSignal },
  tries: number = endTries,
): Promise<void> {
  const { ruleId, skip, signal } = call;
  const rule = tries > 1 ? await parts.rules.get(ruleId, { signal }) : undefined;
  const write =
    rule === undefined
      ? bareSkipOf(skip)
      : await skipWriteOf(parts, { rule, skip, atMs: parts.clock.now(), signal });
  const ended = await parts.rules.endAlert(write, { signal });
  if (ended.ok) {
    await announceAlerts(parts, [ended.value], signal);
    return;
  }
  if (ended.error === "stale") {
    await endAlertSkipped(parts, call, tries - 1);
  }
}
