import { type JsonValue, mulDiv, type Ratio } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import type { AssetInfos } from "@binference/protocol";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { countNotice, type NoticeHour } from "../notices/notice-hour.js";
import { plainResultOf, skipReasonPart } from "../orders/fill-notices.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import { type Notice, type NoticePart, noticePush } from "../pushes/notice-push.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

// Dollars read the same in every language (`$1.20`), so the notice carries them as text.
const dollars = createFormatter({ locale: "en", timeZone: "UTC" });

// The rule as a fill notice names its order: `fill.webhookRule` (spec 4, section 4.4).
function ruleKindOf(rule: Pick<WebhookRuleRecord, "request">): NoticePart {
  return { key: "fill.webhookRule", values: { name: rule.request.name } };
}

/**
 * `notice.fill` for a webhook rule's paper fill (spec 4, section 4.4): what it bought or sold, its
 * value in dollars at the fill and its price per whole token, its order named as the rule.
 */
export function ruleFillNotice(
  rule: Pick<WebhookRuleRecord, "agentId" | "isPaper" | "request">,
  fill: PaperFill & { readonly soldPrice: Ratio },
  traded: { readonly decimals: number; readonly assets: AssetInfos },
): Notice {
  const isBuy = rule.request.side === "buy";
  const valueMicros = mulDiv(fill.amountIn.base, fill.soldPrice, "down");
  const token = isBuy ? fill.amountOut : fill.amountIn;
  const value = dollars.usd(valueMicros);
  const result = plainResultOf({ isBuy, token, value, valueMicros, decimals: traded.decimals });
  const { assets } = traded;
  return {
    key: "notice.fill",
    agent: rule.agentId,
    values: { mode: rule.isPaper ? "paper" : "live" },
    parts: { orderKind: ruleKindOf(rule), result },
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
  };
}

/**
 * `notice.webhookSkipped` for an alert a rule did not fill (spec 4, section 4.4), with its
 * reason's message: the rule stays active. A skip for the rolling cap carries what was used of it
 * and the cap, in dollars.
 */
export function ruleSkippedNotice(
  rule: Pick<WebhookRuleRecord, "agentId" | "request">,
  skip: {
    readonly reason: OrderFillReason;
    readonly cap?: { readonly usedUsdMicros: bigint; readonly capUsdMicros: bigint };
  },
): Notice {
  return {
    key: "notice.webhookSkipped",
    agent: rule.agentId,
    values: {},
    parts: { orderKind: ruleKindOf(rule), reason: skipReasonPart(skip) },
  };
}

// The line that tells how many of a rule's notices its notice hour held back (decision 0337).
function ruleHeldNotice(
  rule: Pick<WebhookRuleRecord, "agentId" | "request">,
  held: number,
): JsonValue {
  const values = { name: rule.request.name, count: String(held) };
  return noticePush({ key: "notice.webhookHeld", agent: rule.agentId, values }).data;
}

/** What a rule tells of one alert's end, and its notice hour after it. */
export interface ToldEnd {
  readonly notices: readonly JsonValue[];
  readonly hour?: NoticeHour;
}

/**
 * What a rule tells of one alert's end, within its notice hour (decision 0337): the first five
 * notices of an hour go out; the rest are counted, and the first notice of the next hour comes
 * after one line that tells how many the hour before held back. An end that tells nothing keeps
 * the hour as it was.
 */
export function toldWithinHour(
  rule: Pick<WebhookRuleRecord, "agentId" | "request" | "noticeHour">,
  call: { readonly notice: Notice | undefined; readonly atMs: number },
): ToldEnd {
  const { notice, atMs } = call;
  if (notice === undefined) {
    return { notices: [] };
  }
  const counted = countNotice(rule.noticeHour, atMs);
  const held = counted.heldBefore > 0 ? [ruleHeldNotice(rule, counted.heldBefore)] : [];
  const told = counted.notify ? [noticePush(notice).data] : [];
  return { notices: [...held, ...told], hour: counted.window };
}
