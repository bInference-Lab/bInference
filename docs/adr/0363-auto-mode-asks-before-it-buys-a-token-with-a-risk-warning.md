# 0363. Auto mode asks before it buys a token with a risk warning

Status: Accepted

Accepted by the owner on 2026-11-04.

## Context

[Decision 0088](../DECISIONS.md#d0088) lets an agent in auto mode buy, sell and swap within its
caps without a tap. The auto test of [spec 6, section 5](../specs/intent-states.md) reads the
caps, the network fee cap, the deny list, the spenders, the outside-content mark and the proposer.
It never read the risk step's result.

[Decision 0112](0112-an-unknown-token-needs-goplus-and-the-round-trip.md) passes a token the chain
registry does not list once GoPlus and the round trip find nothing that blocks it, and lets every
other finding pass with a warning. The card shows two of those warnings: `card.warn.unverified`
for a token the registry does not list, and `card.warn.highTax` for a tax the round trip measured.
In auto mode no card opens, so an agent could buy a token nobody verified, or one that takes a tax
on every trade, and the owner learned of it only from the receipt.

## Decision

- In auto mode, a trade that buys a token with a risk warning opens its card, whatever else the
  auto test finds. A risk warning is any of: the registry does not list the token the trade buys;
  the risk step measured a tax on it, on either leg; the risk step passed it with the verdict
  `warn`. The card shows the warning lines as before.
- A verified token with a measured tax asks too: any warning asks. A tax is money the owner loses
  on every trade, and the card is where it shows.
- The auto test checks it right after the deny list, as `riskWarn`, before the caps. The card says
  "Auto mode asks you here: it buys a token that is not verified or has a risk warning" in English
  and Chinese, and `binference approval auto` names it among what still asks.
- A trade whose stored quote is missing counts as warned, so a doubt asks.
- A sale passes as before: the token it receives is the chain's coin or a registry token.
- Fills are unchanged. An auto order's or a webhook rule's fill is held to the order or rule the
  owner confirmed (decision 0195), not to the auto test. A copy order still buys a warned token
  within its caps, with the warning on its notice
  ([decision 0260](0260-a-copy-order-copies-each-leader-trade-once-at-its-own-size-inside-its-caps.md)).

This amends the auto test of decision 0088.

## Consequences

- Auto mode runs on its own only trades of registry tokens and the chain's coin with no measured
  tax or warning. Every new launch and every token outside the registry gets a card.
- The facts of the auto test gain `hasTokenRiskWarning`, read from the intent's stored quote and
  risk view by the same rules the card uses, and the card record keeps the new `riskWarn` code.
- An agent built to buy new launches in auto mode now asks the owner for each one; an auto order or
  a copy order is the way to buy them without a tap.

## Alternatives

- **Ask only for unverified tokens.** A registry token with a measured tax would still run without
  its tax line ever being seen.
- **Ask only above a tax threshold.** The agent's maximum tax already refuses the worst; below it,
  any tax is still a loss the owner never saw.
- **Apply the rule to fills too.** The owner confirmed each order's token and bounds once, and
  decision 0260 chose to buy warned tokens within a copy order's caps.
