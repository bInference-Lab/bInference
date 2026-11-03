import type { AssetInfos } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { assetsDocument } from "../intents/intent-documents.schema.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import { cancelCard } from "../orders/cancel-order.js";
import type { PaperFills } from "../paper/paper-fills.js";
import { ruleFillNotice, toldWithinHour } from "./alert-fill-notices.js";
import type { AlertFillRecord, AlertFillWrite } from "./alert-fill-record.js";
import { type AlertEndParts, announceAlerts, endAlertSkipped } from "./end-alert.js";
import { isAnswering } from "./webhook-alert.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** What a webhook rule's paper fill writes through. */
export interface RuleFillOnPaperParts extends AlertEndParts {
  readonly paper: PaperFills;
  readonly stored: StoredIntents;
}

/** A rule fill's intent, its rule and its alert, as they stand now. */
interface RuleFill {
  readonly rule: WebhookRuleRecord;
  readonly alert: AlertFillRecord;
}

// A fill whose write lost its race to another write of its rule is tried again this many times.
const fillAttempts = 3;

// The rule and the alert a webhook rule fill's intent fills, as they stand now.
async function ruleFillOf(
  parts: RuleFillOnPaperParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<RuleFill | undefined> {
  const { authorizedBy } = snapshot.stored.status;
  if (authorizedBy === undefined || !("webhookRule" in authorizedBy)) {
    return undefined;
  }
  const [rule, alert] = await Promise.all([
    parts.rules.get(authorizedBy.webhookRule, { signal }),
    parts.rules.alert(authorizedBy.event, { signal }),
  ]);
  return rule === undefined || alert === undefined ? undefined : { rule, alert };
}

/**
 * Whether the rule can count the fill now: its URL still answers, it has a fill left, the alert
 * came to its URL as it is now, by its row, and no other end counted the alert (decisions 0337
 * and 0338).
 */
function canCount({ rule, alert }: RuleFill, nowMs: number): boolean {
  const hasRoom = rule.maxFills === undefined || rule.fills < rule.maxFills;
  const isOwnUrl = alert.event > rule.oldUrlLastEvent;
  return isAnswering(rule, nowMs) && hasRoom && isOwnUrl && alert.outcome === undefined;
}

// What the rule's card stored of the tokens the registry does not list, for the fill's notice.
async function cardAssetsOf(
  parts: RuleFillOnPaperParts,
  rule: WebhookRuleRecord,
  signal: AbortSignal,
): Promise<AssetInfos> {
  const card = await parts.stored.snapshot(rule.intentId, { signal });
  const stored = card?.record.assets;
  return stored === undefined ? {} : assetsDocument.decode(stored);
}

// The fill's write on its alert and rule: the alert filled by this intent, its notice within the
// rule's notice hour, and the rule's count one higher, under the version read. The fill that uses
// the rule's last fill ends the rule `deleted` (decision 0337).
function writeOf(
  found: RuleFill & { readonly intent: IntentSnapshot },
  traded: { readonly decimals: number | undefined; readonly assets: AssetInfos },
): (fill: PaperFill) => Promise<AlertFillWrite> {
  const { rule, alert, intent } = found;
  return async (fill) => {
    const { soldPrice } = fill;
    const { decimals, assets } = traded;
    const notice =
      soldPrice === undefined || decimals === undefined
        ? undefined
        : ruleFillNotice(rule, { ...fill, soldPrice }, { decimals, assets });
    const told = toldWithinHour(rule, { notice, atMs: fill.atMs });
    const count = {
      fills: rule.fills + 1,
      ...(told.hour === undefined ? {} : { noticeHour: told.hour }),
    };
    const isLast = rule.maxFills !== undefined && rule.fills + 1 >= rule.maxFills;
    const state = isLast ? "deleted" : rule.state;
    const move = { id: rule.id, expectedVersion: rule.version, state, atMs: fill.atMs };
    return Promise.resolve({
      event: alert.event,
      outcome: "filled",
      intentId: intent.record.id,
      ...(told.notices.length === 0 ? {} : { notices: told.notices }),
      move: { ...move, ...count },
    });
  };
}

// A fill its rule can no longer count is cancelled unsigned, and its alert ends as a skip.
async function cancelFill(
  parts: RuleFillOnPaperParts,
  run: RuleFill & {
    readonly intent: IntentSnapshot;
    readonly reason: "order_inactive" | "no_price";
  },
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { rule, alert, intent, reason } = run;
  await cancelCard(parts, intent.record.id, signal);
  const skip = {
    event: alert.event,
    reason,
    intentId: intent.record.id,
    tells: reason !== "order_inactive",
  };
  await endAlertSkipped(parts, { ruleId: rule.id, skip, signal });
  return (await parts.stored.snapshot(intent.record.id, { signal })) ?? intent;
}

/**
 * The execute step of a webhook rule's confirmed paper fill (decision 0338): the intent fills at
 * its confirmed quote, and in the same write its alert is marked filled by it and its rule counts
 * the fill, so one alert fills at most once and a rule never past its most fills. A fill its rule
 * can no longer count, as one whose rule was deleted, rotated or used its last fill meanwhile, is
 * cancelled unsigned and its alert skipped. A fill still `confirmed` after a try, because its
 * write lost a race or its sold asset had no usable price, is tried again, up to three tries; then
 * it is cancelled as `no_price`. Any other intent comes back as it was.
 */
export function createRuleFillOnPaper(parts: RuleFillOnPaperParts): ExecuteConfirmed {
  const attempt = async (
    snapshot: IntentSnapshot,
    call: { readonly signal: AbortSignal; readonly left: number; readonly decimals?: number },
  ): Promise<IntentSnapshot> => {
    const { signal, left } = call;
    const found =
      snapshot.record.state === "confirmed" ? await ruleFillOf(parts, snapshot, signal) : undefined;
    if (found === undefined) {
      return snapshot;
    }
    if (!canCount(found, parts.clock.now()) || left <= 0) {
      const reason = left <= 0 ? "no_price" : "order_inactive";
      return cancelFill(parts, { ...found, intent: snapshot, reason }, signal);
    }
    const assets = await cardAssetsOf(parts, found.rule, signal);
    const alert = writeOf({ ...found, intent: snapshot }, { decimals: call.decimals, assets });
    const filled = await parts.paper.fillAtQuote(snapshot, { signal, alert });
    if (filled.record.state !== "confirmed") {
      const ended = await parts.rules.alert(found.alert.event, { signal });
      await announceAlerts(parts, ended === undefined ? [] : [ended], signal);
      return filled;
    }
    return attempt(filled, { ...call, left: left - 1 });
  };
  return async (snapshot, { signal, fill }) =>
    attempt(snapshot, {
      signal,
      left: fillAttempts,
      ...(fill === undefined ? {} : { decimals: fill.decimals }),
    });
}
