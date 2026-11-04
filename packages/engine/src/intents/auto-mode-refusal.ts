/**
 * Why auto mode leaves an intent to the owner's tap, other than that the agent is not in auto
 * mode: the `autoAsks` lines of spec 4, section 3.4. `locked` means the engine is locked, so
 * nothing could sign the intent, `unstake` that it is an unstake, which locks its coin while it
 * unbonds (decision 0296), `deniedToken` that the intent sells a token on the deny list,
 * `riskWarn` that it buys a token that is not verified or has a risk warning (decision 0363),
 * `overFeeCap` that its fee per gas is above the network fee cap, and `spender` that a step
 * approves a spender outside the registry, and `plugin` that a community plugin is on, whose words
 * reach every turn of the agent (decision 0350). A card version auto mode opened keeps its code.
 */
export const autoAskCodes = [
  "locked",
  "send",
  "kind",
  "unstake",
  "deniedToken",
  "riskWarn",
  "overCap",
  "overFeeCap",
  "spender",
  "plugin",
  "outside",
  "mcp",
] as const;

/** Why auto mode opened a card instead of filling the intent. */
export type AutoAskCode = (typeof autoAskCodes)[number];

/**
 * Why auto mode leaves an intent to the owner's tap: `manual` when the agent is not in auto mode,
 * otherwise the {@link AutoAskCode} its card shows.
 */
export type AutoModeRefusal = "manual" | AutoAskCode;
