import type { CardAction } from "../confirmations/card-action.js";
import type { UnfreezeQuote } from "../intents/unfreeze-quote.js";

/**
 * What an unfreeze's card and its receipt name (decision 0128): the one agent it unfreezes, or,
 * for the whole install, how many agents its quote found frozen.
 */
export function unfreezeActionOf(quote: UnfreezeQuote): CardAction<"unfreeze"> {
  const [only] = quote.agents;
  return quote.isWholeInstall || only === undefined
    ? { kind: "unfreeze", scope: "install", agentCount: quote.agents.length }
    : { kind: "unfreeze", scope: "agent", agent: only.name };
}
