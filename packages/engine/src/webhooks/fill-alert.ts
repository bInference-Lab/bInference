import type { Id } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import { inFlightStates } from "../intents/fills-in-flight.js";
import { isTerminalState } from "../intents/intent-state.js";
import { withinDeadline } from "../orders/fill-faults.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import type { AlertFillRecord } from "./alert-fill-record.js";
import { type AlertSkip, announceAlerts, endAlertSkipped } from "./end-alert.js";
import { proposeRuleFill } from "./propose-rule-fill.js";
import { cancelAlertFill } from "./repair-rule-fills.js";
import { isHeldByOwnFill, ruleLineOf } from "./rule-fill-line.js";
import { isAnswering } from "./webhook-alert.js";
import type { WebhookFillParts } from "./webhook-fills.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** How long after its arrival an alert's fill may start: one minute (decision 0336). */
export const webhookFillWindowMs = 60_000;

// Why an alert fills nothing before its agent's line, or `undefined` to go on (decisions 0336,
// 0337 and 0342): one its rule's old URL took, by its row, or one of a rule that no longer
// answers, recorded only; one of a live rule while live fills are off, or taken or run while the
// engine is locked, told.
function earlySkipOf(
  parts: Pick<WebhookFillParts, "clock" | "isLocked" | "liveFills">,
  rule: WebhookRuleRecord,
  alert: AlertFillRecord,
): Omit<AlertSkip, "event"> | undefined {
  if (alert.event <= rule.oldUrlLastEvent) {
    return { reason: "url_rotated", tells: false };
  }
  const hasRoom = rule.maxFills === undefined || rule.fills < rule.maxFills;
  if (!isAnswering(rule, parts.clock.now()) || !hasRoom) {
    return { reason: "order_inactive", tells: false };
  }
  if (!rule.isPaper && !parts.liveFills) {
    return { reason: "live_fills_off", tells: true };
  }
  const isLocked = alert.wasEngineLocked || parts.isLocked();
  return isLocked ? { reason: "engine_locked", tells: true } : undefined;
}

// Why an alert fills nothing at the head of its agent's line: one past its minute, or of an agent
// frozen, archived or gone since.
function lineSkipOf(
  parts: Pick<WebhookFillParts, "clock">,
  alert: AlertFillRecord,
  settings: AgentSettings | undefined,
): Omit<AlertSkip, "event"> | undefined {
  // An alert stamped after now, as a clock set back leaves one, is late too (decision 0336).
  const ageMs = parts.clock.now() - alert.receivedAtMs;
  if (ageMs < 0 || ageMs >= webhookFillWindowMs) {
    return { reason: "late", tells: true };
  }
  if (settings === undefined || settings.agent.archivedAtMs !== undefined) {
    return { reason: "order_inactive", tells: false };
  }
  return settings.agent.frozenAtMs === undefined ? undefined : { reason: "frozen", tells: true };
}

// What the fill's intent came to: a paper fill ended its alert in its own write, as a live fill's
// refusal did, which are told now; a live fill the executor holds ends its alert as it ends
// (decision 0342); any other intent ended by a refusal is a skip with its reason, and anything
// left open a fault of the fill.
async function endOfIntent(
  parts: WebhookFillParts,
  run: {
    readonly rule: WebhookRuleRecord;
    readonly alert: AlertFillRecord;
    readonly signal: AbortSignal;
  },
  proposed: Awaited<ReturnType<typeof proposeRuleFill>>,
): Promise<void> {
  const { rule, alert, signal } = run;
  const ruleId = rule.id;
  if (proposed.kind === "skip") {
    await endAlertSkipped(parts, {
      ruleId,
      skip: { ...proposed.skip, event: alert.event },
      signal,
    });
    return;
  }
  const { record } = proposed.snapshot;
  const ended = await parts.rules.alert(alert.event, { signal });
  if (ended?.outcome !== undefined) {
    await announceAlerts(parts, [ended], signal);
    return;
  }
  if (!record.isPaper && inFlightStates.includes(record.state)) {
    return;
  }
  const reason: OrderFillReason = record.reason ?? "fill_failed";
  const cap =
    reason === "daily_cap"
      ? {
          cap: {
            usedUsdMicros: await parts.gate.spent(proposed.snapshot, { signal }),
            capUsdMicros: proposed.snapshot.settings.limits.rollingDayUsdMicros,
          },
        }
      : {};
  const end: OrderFillReason = isTerminalState(record.state) ? reason : "fill_failed";
  const skip = { event: alert.event, reason: end, intentId: record.id, tells: true, ...cap };
  await endAlertSkipped(parts, { ruleId, skip, signal });
}

// The alert in its agent's line: skipped there, held by its live line, or proposed on the money
// path within the fill's deadline; a rule that is gone ends the alert `order_inactive`.
async function fillInLine(
  parts: WebhookFillParts,
  run: {
    readonly ruleId: Id<"whr">;
    readonly alert: AlertFillRecord;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  const { ruleId, alert, signal } = run;
  const rule = await parts.rules.get(ruleId, { signal });
  const settings =
    rule === undefined ? undefined : await parts.agents.get(rule.agentId, { signal });
  const early =
    rule === undefined
      ? undefined
      : (earlySkipOf(parts, rule, alert) ?? lineSkipOf(parts, alert, settings));
  if (rule === undefined || early !== undefined || settings === undefined) {
    const skip = { event: alert.event, ...(early ?? { reason: "order_inactive", tells: false }) };
    await endAlertSkipped(parts, { ruleId, skip, signal });
    return;
  }
  if (await isLineFree(parts, { rule, alert, signal })) {
    await proposeWithin(parts, { rule, alert, settings, signal });
  }
}

// Proposes the alert's fill within the fill's deadline. A fill that threw or ran past it cancels,
// unsigned, any intent it stored and is a skip, `fill_failed` (decision 0338); one the executor
// already holds ends the alert as it ends (decision 0342).
async function proposeWithin(
  parts: WebhookFillParts,
  run: {
    readonly rule: WebhookRuleRecord;
    readonly alert: AlertFillRecord;
    readonly settings: AgentSettings;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  const { rule, alert, settings, signal } = run;
  try {
    const proposed = await withinDeadline({ clock: parts.clock, signal }, async (deadline) =>
      proposeRuleFill(parts, { rule, alert, settings, signal: deadline }),
    );
    await endOfIntent(parts, { rule, alert, signal }, proposed);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    await cancelAlertFill(parts, { agentId: rule.agentId, event: alert.event }, signal);
    if (await isHeldByOwnFill(parts, { rule, alert, signal })) {
      return;
    }
    const skip = { event: alert.event, reason: "fill_failed" as const, tells: true };
    await endAlertSkipped(parts, { ruleId: rule.id, skip, signal });
  }
}

// Whether a live rule's alert may fill at the head of its line (decision 0342); else it is skipped
// behind another live fill or while its rule backs off.
async function isLineFree(
  parts: WebhookFillParts,
  run: {
    readonly rule: WebhookRuleRecord;
    readonly alert: AlertFillRecord;
    readonly signal: AbortSignal;
  },
): Promise<boolean> {
  const { rule, alert, signal } = run;
  const line = await ruleLineOf(parts, { rule, signal });
  if (line.kind === "free") {
    return true;
  }
  const skip = { event: alert.event, ...line.skip };
  await endAlertSkipped(parts, { ruleId: rule.id, skip, signal });
  return false;
}

/**
 * Whether an alert is left to its own live fill, which the executor holds and which alone ends it
 * (decision 0342), whatever else holds then: its minute passed, the engine is locked, or the run
 * failed. An alert with no rule has none.
 */
export async function isLeftToItsFill(
  parts: Pick<WebhookFillParts, "intents" | "chains" | "clock">,
  call: {
    readonly rule: WebhookRuleRecord | undefined;
    readonly alert: Pick<AlertFillRecord, "event">;
    readonly signal: AbortSignal;
  },
): Promise<boolean> {
  const { rule, alert, signal } = call;
  return rule !== undefined && (await isHeldByOwnFill(parts, { rule, alert, signal }));
}

/**
 * Fills or skips one accepted alert of a run (decisions 0336 to 0338): left untouched when its own
 * live fill is held by the executor (decision 0342); skipped before its agent's line when its
 * rule's old URL took it, its rule no longer answers, is live, or the engine was locked; else at the
 * head of the line, where it skips past its minute or for a frozen agent, or is proposed on the
 * money path within the fill's deadline. An alert whose rule is gone ends `order_inactive`.
 */
export async function fillAlert(
  parts: WebhookFillParts,
  taken: { readonly alert?: AlertFillRecord; readonly rule?: WebhookRuleRecord },
  signal: AbortSignal,
): Promise<void> {
  const { alert, rule } = taken;
  if (alert === undefined) {
    return;
  }
  if (await isLeftToItsFill(parts, { rule, alert, signal })) {
    return;
  }
  const ruleId = rule?.id ?? alert.ruleId;
  const early = rule === undefined ? undefined : earlySkipOf(parts, rule, alert);
  if (early !== undefined || rule === undefined) {
    const skip = { event: alert.event, ...(early ?? { reason: "order_inactive", tells: false }) };
    await endAlertSkipped(parts, { ruleId, skip, signal });
    return;
  }
  await parts.inLine(rule.agentId, async () => fillInLine(parts, { ruleId, alert, signal }));
}
