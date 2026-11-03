import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import { ruleFillOfAuthorization } from "../intents/fills-in-flight.js";
import { failureReasons } from "../intents/intent-reason.js";
import { fillsHoldingLine } from "../orders/fill-faults.js";
import { chainFailuresInRow, paceRows, waitAfterFailures } from "../orders/fill-pacing.js";
import type { IntentStore } from "../ports.js";
import type { AlertFillRecord } from "./alert-fill-record.js";
import type { AlertSkip } from "./end-alert.js";
import type { WebhookRuleStore } from "./ports.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** What a live rule's line reads: its agent's fills in flight, the rule's fills, and the time. */
export interface RuleLineParts {
  readonly intents: Pick<IntentStore, "fillsInFlight" | "get">;
  readonly rules: Pick<WebhookRuleStore, "alerts">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/**
 * Where an alert of a live rule stands at the head of its agent's line (decision 0342): free to
 * fill, or skipped behind another live fill still settling or while the rule's fills back off.
 */
export type RuleLine =
  | { readonly kind: "free" }
  | { readonly kind: "skip"; readonly skip: Omit<AlertSkip, "event"> };

const waiting = { kind: "skip", skip: { reason: "fill_waiting", tells: true } } as const;

// The reasons a fill failed on chain, which back a rule's fills off (decision 0211).
const failures: ReadonlySet<string> = new Set<string>(failureReasons);

/**
 * Whether a live rule's alert is held by its own fill, which the executor holds (decision 0342):
 * then nothing but that fill's own end may end the alert, so the runner leaves it, past its
 * minute, while the engine is locked, and after a fault alike. A paper rule's alert never is.
 */
export async function isHeldByOwnFill(
  parts: Pick<RuleLineParts, "intents" | "chains" | "clock">,
  call: {
    readonly rule: WebhookRuleRecord;
    readonly alert: Pick<AlertFillRecord, "event">;
    readonly signal: AbortSignal;
  },
): Promise<boolean> {
  const { rule, alert, signal } = call;
  const held = await fillsHoldingLine(parts, rule, signal);
  return held.some((record) => {
    const fill = ruleFillOfAuthorization(record.authorizedBy);
    return fill?.rule === rule.id && fill.event === alert.event;
  });
}

// Whether the rule's fills still back off after failing on chain: until the wait after its last
// failure, by when its fill's intent ended, passed.
async function isBackingOff(
  parts: RuleLineParts,
  rows: readonly AlertFillRecord[],
  signal: AbortSignal,
): Promise<boolean> {
  const wait = waitAfterFailures(chainFailuresInRow(rows));
  const last = rows.find(({ reason }) => reason !== undefined && failures.has(reason));
  if (wait === 0 || last?.intentId === undefined) {
    return false;
  }
  const failed = await parts.intents.get(last.intentId, { signal });
  return failed !== undefined && parts.clock.now() < failed.changedAtMs + wait;
}

/**
 * Reads where a live rule's alert stands at the head of its agent's line (decision 0342), once
 * the runner left an alert its own fill holds. A paper rule's alert is always free: it waits
 * behind no live fill. The back-off reads the rule's fills alone, so the alerts skipped between
 * them never push a failure out.
 */
export async function ruleLineOf(
  parts: RuleLineParts,
  call: { readonly rule: WebhookRuleRecord; readonly signal: AbortSignal },
): Promise<RuleLine> {
  const { rule, signal } = call;
  if (rule.isPaper) {
    return { kind: "free" };
  }
  if ((await fillsHoldingLine(parts, rule, signal)).length > 0) {
    return waiting;
  }
  const rows = await parts.rules.alerts(
    { ruleId: rule.id, limit: paceRows, onlyFills: true },
    { signal },
  );
  return (await isBackingOff(parts, rows, signal)) ? waiting : { kind: "free" };
}
