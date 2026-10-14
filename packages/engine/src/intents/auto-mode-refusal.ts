/**
 * Why auto mode leaves an intent to the owner's tap, other than that the agent is not in auto
 * mode: the `autoAsks` lines of spec 4, section 3.4. `locked` means the engine is locked, so
 * nothing could sign the intent, `deniedToken` that the intent sells a token on the deny list,
 * `overFeeCap` that its fee per gas is above the network fee cap, and `spender` that a step
 * approves a spender outside the registry. A card version auto mode opened keeps its code.
 */
export const autoAskCodes = [
  "locked",
  "send",
  "kind",
  "deniedToken",
  "overCap",
  "overFeeCap",
  "spender",
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
