import type { CapGate } from "../confirmations/cap-gate.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { failureReasons } from "../intents/intent-reason.js";
import { fillRuleOf, type SkipEnd, skipEndOf } from "../orders/fill-ends.js";
import { chainFailuresInRow, stopAfterFailures } from "../orders/fill-pacing.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import { ruleEndedNotice } from "./alert-fill-notices.js";
import type { AlertFillWrite } from "./alert-fill-record.js";
import { ruleEndingWriteOf, skipWriteOf } from "./end-alert.js";
import type { WebhookRuleStore } from "./ports.js";
import { type LandedRuleFillParts, landedRuleFillWrite } from "./rule-fill-landed.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/**
 * The write on its alert of a move that ends a live webhook rule fill (decision 0342), which the
 * one writer of intents stores with the move: the fill as it reconciles, or its skip as it ends
 * otherwise. `undefined` for a move that carries its own, ends no fill, or is of a paper fill or
 * no rule's fill: a paper fill writes its own end.
 */
export type RuleFillEnd = (
  before: IntentSnapshot,
  move: IntentMove,
  options: { readonly signal: AbortSignal },
) => Promise<AlertFillWrite | undefined>;

/** What the write that ends a rule fill reads, and a landed live fill's write with it. */
export interface RuleFillEndParts {
  readonly rules: Pick<WebhookRuleStore, "get" | "alert" | "alerts">;
  /**
   * What a live fill that landed writes on its alert with, in the move that reconciles it; the
   * executor's writer has it, and a writer without it records none.
   */
  readonly landed?: LandedRuleFillParts;
  /** What the agent used of the rolling cap, which a skip for the cap tells; none when absent. */
  readonly spent?: CapGate["spent"];
}

// The reasons a fill failed on chain, which end a rule at the fifth since its last fill.
const failures: ReadonlySet<string> = new Set<string>(failureReasons);

// What the owner reads of a skip for the rolling cap: what the agent used of it, and the cap.
async function capOf(
  parts: RuleFillEndParts,
  skip: { readonly before: IntentSnapshot; readonly ended: SkipEnd; readonly signal: AbortSignal },
) {
  const { before, ended, signal } = skip;
  if (ended.reason !== "daily_cap" || parts.spent === undefined) {
    return {};
  }
  const usedUsdMicros = await parts.spent(before, { signal });
  return { cap: { usedUsdMicros, capUsdMicros: before.settings.limits.rollingDayUsdMicros } };
}

// The live fill a move reconciles: the trade it settled; `undefined` for any other move.
function landedOf(move: IntentMove): SettledTrade | undefined {
  return move.step.status.state === "reconciled" ? move.settled : undefined;
}

// Why a move ends a rule fill without filling, as an order's: a fill the start's repair cancels
// unsigned is told, since no executor notice tells it (decision 0338).
function ruleSkipEndOf(before: IntentSnapshot, move: IntentMove): SkipEnd | undefined {
  const ended = skipEndOf(before, move);
  const isRepaired = move.step.event.cancelCause === "engine_stopping";
  return ended !== undefined && isRepaired ? { reason: ended.reason } : ended;
}

// The rule and alert row of a live rule fill whose move carries no write on its alert yet.
function liveRuleFillOf(before: IntentSnapshot, move: IntentMove) {
  const fill = fillRuleOf(before);
  return before.record.isPaper || move.alert !== undefined ? undefined : fill;
}

// How the skip ends its rule with it (decision 0342): the owner's cancel of the fill, or its fifth
// fill failed on chain since its last fill, counted from the rule's fills alone, so the alerts
// skipped between them never push a failure out; `undefined` when the rule stays. The alert this
// skip ends has no end yet, so the rule's fills read are those before it.
async function ruleEndOf(
  parts: RuleFillEndParts,
  call: {
    readonly rule: WebhookRuleRecord;
    readonly reason: OrderFillReason;
    readonly signal: AbortSignal;
  },
): Promise<"owner_cancelled" | "fills_failing" | undefined> {
  const { rule, reason, signal } = call;
  if (reason === "owner_cancelled") {
    return reason;
  }
  if (!failures.has(reason)) {
    return undefined;
  }
  const query = { ruleId: rule.id, limit: stopAfterFailures, onlyFills: true };
  const rows = await parts.rules.alerts(query, { signal });
  return chainFailuresInRow(rows) + 1 >= stopAfterFailures ? "fills_failing" : undefined;
}

// The skip's write on its alert, told once per reason in a row unless the executor tells it, or,
// when it ends the rule, with the move that ends it and the notice that tells it (decision 0342).
async function skipOf(
  parts: RuleFillEndParts,
  call: {
    readonly before: IntentSnapshot;
    readonly ended: SkipEnd;
    readonly event: number;
    readonly rule: WebhookRuleRecord;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<AlertFillWrite> {
  const { before, ended, event, rule, atMs, signal } = call;
  const skip = {
    event,
    reason: ended.reason,
    intentId: before.record.id,
    tells: ended.tells ?? true,
    ...(await capOf(parts, { before, ended, signal })),
  };
  const end = await ruleEndOf(parts, { rule, reason: ended.reason, signal });
  return end === undefined
    ? skipWriteOf({ rules: parts.rules }, { rule, skip, atMs, signal })
    : ruleEndingWriteOf(rule, { skip, atMs, notice: ruleEndedNotice(rule, end) });
}

// The landed fill's write on its alert, once: none for a fill counted already, before it could be
// valued (decision 0342).
async function landedOnce(
  parts: Pick<RuleFillEndParts, "rules"> & { readonly landed: LandedRuleFillParts },
  landing: Parameters<typeof landedRuleFillWrite>[1],
): Promise<AlertFillWrite | undefined> {
  const alert = await parts.rules.alert(landing.event, { signal: landing.signal });
  return alert?.outcome === "filled" ? undefined : landedRuleFillWrite(parts.landed, landing);
}

/**
 * Creates the {@link RuleFillEnd} the one writer of intents adds to each move of a live rule fill:
 * its skip, or, with `landed`, its fill on its alert and rule as it reconciles.
 */
export function createRuleFillEnd(parts: RuleFillEndParts): RuleFillEnd {
  return async (before, move, { signal }) => {
    const fill = liveRuleFillOf(before, move);
    const settled = landedOf(move);
    const ended = ruleSkipEndOf(before, move);
    const { landed } = parts;
    const lands = settled !== undefined && landed !== undefined;
    if (fill === undefined || (!lands && ended === undefined)) {
      return undefined;
    }
    const rule = await parts.rules.get(fill.rule, { signal });
    if (rule === undefined) {
      return undefined;
    }
    const { event } = fill;
    const atMs = move.step.event.atMs;
    if (settled !== undefined && landed !== undefined) {
      const landing = { rule, event, snapshot: before, settled, atMs, signal };
      return landedOnce({ rules: parts.rules, landed }, landing);
    }
    return ended === undefined
      ? undefined
      : skipOf(parts, { before, ended, event, rule, atMs, signal });
  };
}
