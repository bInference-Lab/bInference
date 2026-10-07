/** What an MCP client shows for one tool and what its model reads. MCP tool texts stay English. */
export interface ToolText {
  readonly title: string;
  readonly description: string;
}

const units =
  "Amounts are base units as decimal strings; USD values are micro-dollars as decimal strings.";

const ids = "Tokens are CAIP-19 asset ids and addresses are CAIP-10 account ids.";

const waits =
  "Nothing moves until the owner confirms the card in Telegram or the console; no tool can confirm.";

/** What the model reads about the `requestId` a propose tool takes. */
export const requestIdText =
  "Optional. A new unique id for this proposal, such as a UUID. Send the same id again only to retry this same call after an error or a timeout: the retry returns the first intent and its card instead of a new one. Never reuse an id for another proposal.";

/**
 * The title and description of each tool, by tool name. The input schema and the operation come
 * from the protocol; these texts only tell the model when to use the tool.
 */
export const toolTexts: Readonly<Record<string, ToolText>> = {
  binference_portfolio: {
    title: "Portfolio",
    description: `Reads an agent's portfolio: the balance of each wallet, open positions with their profit and loss, and whether they are paper. ${units}`,
  },
  binference_token_info: {
    title: "Token info",
    description: `Reads a token's symbol, name, decimals, verified mark and its last risk check. ${ids}`,
  },
  binference_token_risk: {
    title: "Token risk",
    description: `Checks a token's risk before a trade: buy and sell tax, liquidity and flags such as a honeypot, with a verdict. ${ids}`,
  },
  binference_quote: {
    title: "Quote a swap",
    description: `Quotes a swap without proposing it: the route, the expected and minimum output, the price impact and the gas. ${ids} ${units}`,
  },
  binference_orders: {
    title: "Auto orders",
    description:
      "Lists auto orders (limit, take-profit, stop-loss, trailing, DCA and copy) by agent and state, a page at a time.",
  },
  binference_resolve_name: {
    title: "Resolve a name",
    description: "Resolves a name such as owner.bnb to the address it points to.",
  },
  binference_propose: {
    title: "Propose an intent",
    description: `Proposes one action for the owner to confirm, such as a swap, buy, sell or send. ${waits} The answer names the intent and its state; follow it with binference_intent_status. A refusal by policy or risk comes back as an intent in a refused state with its reason. ${ids} ${units}`,
  },
  binference_intent_status: {
    title: "Intent status",
    description:
      "Reads one intent: its state, terms, card and outcome. Use it to follow a proposal until the owner confirms or denies it.",
  },
  binference_order_create: {
    title: "Propose an auto order",
    description: `Proposes an auto order. ${waits} Once confirmed, each fill runs inside the order's bounds. ${ids} ${units}`,
  },
  binference_order_cancel: {
    title: "Cancel an auto order",
    description: "Cancels an auto order this client proposed.",
  },
  binference_alert_create: {
    title: "Create an alert",
    description:
      "Creates a price alert that notifies the owner when the price crosses a level. It sends no transaction.",
  },
  binference_ledger: {
    title: "Ledger",
    description:
      "Lists ledger entries by agent and time range, a page at a time. Each entry records one thing that happened, such as a fill, and carries the hash that chains it to the entry before.",
  },
};
