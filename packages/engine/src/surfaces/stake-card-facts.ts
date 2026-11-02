import type { CardAction } from "../confirmations/card-action.js";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { StakeIntentQuote } from "../intents/stake-quote.js";
import type { CardSource } from "./card-facts-of.js";

const secondsPerDay = 86_400;
const msPerSecond = 1_000;

/**
 * A staking move's action from its quote (spec 4, section 3.9): a stake names the coin it sends,
 * an unstake and a claim the coin they take out; the validator by its name and address, with its
 * commission and yearly rate, and for an unstake the unbonding time in whole days, rounded up, and
 * when its coin can be claimed: the venue counts from the block the unstake lands in, so the card
 * shows the ready time of one that lands as the card expires, which no tap makes later.
 */
function stakeActionOf(quote: StakeIntentQuote, expiresAtMs: number): CardAction<"stake"> {
  const { plan } = quote;
  const { validator, validatorName, commissionBps, aprBps } = plan;
  const latestMs = expiresAtMs + plan.unbondingSeconds * msPerSecond;
  const readyAtMs = plan.readyAtMs === undefined ? undefined : Math.max(plan.readyAtMs, latestMs);
  const base = {
    kind: "stake",
    validator,
    validatorName,
    details: {
      commissionBps,
      ...(aprBps === undefined || plan.action !== "stake" ? {} : { aprBps }),
      ...(readyAtMs === undefined ? {} : { readyAtMs }),
    },
  } as const;
  if (plan.action === "unstake") {
    const readyInDays = Math.ceil(plan.unbondingSeconds / secondsPerDay);
    return { ...base, action: "unstake", amount: plan.moved, readyInDays };
  }
  return plan.action === "stake"
    ? { ...base, action: "stake", amount: plan.value }
    : { ...base, action: "claim", amount: plan.moved };
}

/**
 * The facts of a staking move's card (spec 4, sections 3.3 and 3.9), from its quote, which the
 * card's terms hash covers; then the agent's reason.
 */
export function stakeCardFacts(
  quote: StakeIntentQuote,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts {
  const { record, card, settings } = source;
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: stakeActionOf(quote, card.expiresAtMs),
    warnings,
    reason: requestDocument.decode(record.request).reason,
  };
}
