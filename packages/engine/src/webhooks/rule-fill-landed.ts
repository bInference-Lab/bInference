import { type ChainRegistry, type PriceSource, withQuotePrice } from "@binference/chain";
import type { JsonValue, Ratio } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { assetsDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { LandedTrade } from "../orders/fill-landed.js";
import type { IntentStore } from "../ports.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { ruleFillNotice, ruleOverfilledNotice, toldWithinHour } from "./alert-fill-notices.js";
import type { AlertFillWrite } from "./alert-fill-record.js";
import type { WebhookRuleMove, WebhookRuleRecord } from "./webhook-rule-record.js";

/** What a landed live rule fill's write on its alert reads for its notice. */
export interface LandedRuleFillParts {
  /** The rule's card intent, which holds what the card showed of a token the registry lacks. */
  readonly intents: Pick<IntentStore, "get">;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
}

// The decimals of the rule's token, the registry's or what its card stored, and the tokens the
// registry does not list that its card showed.
async function tokenOf(
  parts: LandedRuleFillParts,
  rule: WebhookRuleRecord,
  signal: AbortSignal,
): Promise<{ readonly decimals?: number; readonly assets: AssetInfos }> {
  const { token } = rule.request;
  const listed = assetInfoOf(parts.chains, token);
  if (listed !== undefined) {
    return { decimals: listed.decimals, assets: {} };
  }
  const card = await parts.intents.get(rule.intentId, { signal });
  const assets = card?.assets === undefined ? {} : assetsDocument.decode(card.assets);
  const decimals = assets[token]?.decimals;
  return decimals === undefined ? { assets } : { decimals, assets };
}

// The sold asset's USD price per base unit, from its feed or else the fill's own quote.
async function soldPriceOf(
  parts: LandedRuleFillParts,
  call: { readonly snapshot: IntentSnapshot; readonly settled: LandedTrade },
  signal: AbortSignal,
): Promise<Ratio | undefined> {
  const quote = quoteDocument.decode(call.snapshot.record.quote ?? null);
  const priced = withQuotePrice(parts.prices, quote);
  const price = await priced.usdPrice(call.settled.amountIn.asset, { signal });
  return price.ok && isUsablePrice(price.value) ? price.value : undefined;
}

// The rule's move that counts the fill, ending the rule with its last fill (decision 0337); none
// for a rule deleted meanwhile, which never moves again.
function countOf(
  rule: WebhookRuleRecord,
  call: { readonly atMs: number; readonly noticeHour?: WebhookRuleMove["noticeHour"] },
): WebhookRuleMove | undefined {
  if (rule.state === "deleted") {
    return undefined;
  }
  const fills = rule.fills + 1;
  const isLast = rule.maxFills !== undefined && fills >= rule.maxFills;
  const state = isLast ? "deleted" : rule.state;
  const hour = call.noticeHour === undefined ? {} : { noticeHour: call.noticeHour };
  return { id: rule.id, expectedVersion: rule.version, state, atMs: call.atMs, fills, ...hour };
}

/**
 * The write on its alert of a live rule fill that landed (decision 0342), stored with the move that
 * reconciles it or with its late landing: the alert `filled` by the intent, and the fill counted on
 * the rule whatever the rule became, its last fill ending it, a deleted rule left as it is. The
 * owner hears `notice.fill` within the rule's notice hour, and `notice.orderOverfilled` when the
 * count passes the rule's most fills.
 */
export async function landedRuleFillWrite(
  parts: LandedRuleFillParts,
  call: {
    readonly rule: WebhookRuleRecord;
    readonly event: number;
    readonly snapshot: IntentSnapshot;
    readonly settled: LandedTrade;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<AlertFillWrite> {
  const { rule, settled, atMs, signal } = call;
  const [token, soldPrice] = await Promise.all([
    tokenOf(parts, rule, signal),
    soldPriceOf(parts, call, signal),
  ]);
  const { decimals, assets } = token;
  const traded = { amountIn: settled.amountIn, amountOut: settled.amountOut, atMs };
  const notice =
    soldPrice === undefined || decimals === undefined
      ? undefined
      : ruleFillNotice(rule, { ...traded, soldPrice }, { decimals, assets });
  const told = toldWithinHour(rule, { notice, atMs });
  const isOver = rule.maxFills !== undefined && rule.fills >= rule.maxFills;
  const notices: readonly JsonValue[] = [
    ...told.notices,
    ...(isOver ? [ruleOverfilledNotice(rule)] : []),
  ];
  const move = countOf(rule, {
    atMs,
    ...(told.hour === undefined ? {} : { noticeHour: told.hour }),
  });
  return {
    event: call.event,
    outcome: "filled",
    intentId: call.snapshot.record.id,
    ...(notices.length === 0 ? {} : { notices }),
    ...(move === undefined ? {} : { move }),
  };
}
