import type { AssetRef } from "@binference/chain";
import type { WebhookRuleRequest } from "@binference/protocol";
import type { CardLine, CardValue } from "./card-line.js";
import { sellLine, spendLine } from "./order-card-lines.js";

/**
 * A webhook rule's terms as its card and its receipt draw them (decision 0299): its name, its
 * bounds with every default filled, the coin a buy spends when it names nothing, its rate, its
 * most fills and its expiry.
 */
export interface WebhookRuleAction {
  readonly name: string;
  readonly request: WebhookRuleRequest;
  /** What a buy spends: the request's `spend`, else the chain's coin. */
  readonly spend: AssetRef;
  readonly ratePerMinute: number;
  /** Absent: no limit on its fills. */
  readonly maxFills?: number;
  readonly expiresAtMs: number;
}

const asset = (token: AssetRef): CardValue => ({ type: "asset", asset: token });
const line = (drawn: CardLine): CardValue => ({ type: "line", line: drawn });

/**
 * What each alert of a rule trades (spec 4, section 3.9): a buy of its token with what it spends,
 * or a sale of its size, as an auto order's summary words them.
 */
export function webhookRuleSummary(action: WebhookRuleAction): CardLine {
  const { request } = action;
  return request.side === "buy"
    ? {
        key: "card.webhookRule.buy",
        values: {
          token: asset(request.token),
          spend: line(spendLine(action.spend, request.size)),
        },
      }
    : {
        key: "card.webhookRule.sell",
        values: { sell: line(sellLine(request.token, request.size)) },
      };
}

/** A rule's action line: its name, what each alert trades and its rate. */
export function webhookRuleActionLine(action: WebhookRuleAction): CardLine {
  return {
    key: "card.webhookRule.action",
    values: {
      name: { type: "text", text: action.name },
      summary: line(webhookRuleSummary(action)),
      rate: { type: "count", count: action.ratePerMinute },
    },
  };
}

/**
 * The lines under a rule's action (spec 4, section 3.9; decisions 0337 and 0338): how many fills
 * it allows until when, the most slippage each fill takes when the rule names it, that its URL
 * works once confirmed for anyone who holds it, and that it fills on paper only.
 */
export function webhookRuleDetailLines(action: WebhookRuleAction): readonly CardLine[] {
  const { maxSlippageBps } = action.request;
  return [
    {
      key: "card.webhookRule.limits",
      values: {
        maxFills: { type: "count", count: action.maxFills ?? 0 },
        expiry: { type: "dateTime", atMs: action.expiresAtMs },
      },
    },
    ...(maxSlippageBps === undefined
      ? []
      : [
          {
            key: "card.webhookRule.slippage",
            values: { slippage: { type: "percent", bps: maxSlippageBps } },
          } as const,
        ]),
    { key: "card.webhookRule.url", values: {} },
    { key: "card.webhookRule.paper", values: {} },
  ];
}
