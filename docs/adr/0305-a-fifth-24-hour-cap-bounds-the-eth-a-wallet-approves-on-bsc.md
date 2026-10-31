# 0305. A fifth 24-hour cap bounds the ETH a wallet approves on BSC

Status: Accepted

Proposed with the owner's ruling of 2026-10-31: ETH bridges stay in v1 (Across's ETH to WETH on
Ethereum, Base, Arbitrum and Robinhood Chain), with a fifth Privy 24-hour cap on BSC ETH, at twice
the daily limit with a $1,000 floor, sized like the other caps, which decision 0151's resize
reaches.

## Context

[Decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md) caps, per rolling 24 hours,
the BNB the wallets send and their approvals of WBNB, USDT and USDC: 4 of the 10 aggregations a
Privy app keeps. It promises that a stolen machine loses at most those caps through venue calls,
and that it can sell any token the caps do not name at any price.

A bridge deposit through Across names its `outputAmount`, and Across's relayers are
permissionless: a thief can deposit with an `outputAmount` near nothing, fill it as a relayer to
the saved recipient, and be repaid the input ([decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md)).
Across's ETH routes from BSC take Binance-Peg ETH (`0x2170...F933F8`), a BEP-20 token no cap
names, so a deposit of it could empty the ETH the wallet holds.

## Decision

- **ETH joins the capped tokens on BSC**, after WBNB, USDT and USDC: one more aggregation of the
  `approve.amount` sent to the ETH token, and the approval rule compares its sum with its cap, as
  it does each token's.
- **Its size** is the agent-wide day doubled, as every cap: `2 x defaults.limits.rollingDayUsd`, at
  a floor of $1,000 per ETH, rounded up. With the default $500 day that is 1 ETH.
- **The resize** of decision 0151 reaches it: `binference ceiling set --day-cap-usd` sizes it with
  the others.
- **Custody enforces it.** A ceiling never holds a bridge route whose token that leaves has no
  24-hour approval cap on its chain: the builder refuses such a ceiling (`uncapped_token`), so a
  route and its token's cap always land in the same policy. The check runs in custody, under the
  owner key's signature, never in a venue plugin on the engine's side.
- **Ceilings made before.** Caps are matched by their place in the chain's list, ETH last, so an
  install made before this decision keeps its three token caps and a resize sizes those. The
  change of calls that first adds an ETH route makes the ETH cap with the owner key and adds it to
  every ceiling it writes, or, when the cap cannot be made, adds neither. A wallet made later takes
  the install's caps with the most token caps, ETH's among them. The owner hears that approvals of
  ETH had no 24-hour cap until that change (`notice.dayCapAdded`).

## Consequences

- A machine whose keys are all stolen can lose through ETH approvals at most the ETH cap a day,
  counted in ETH (1 ETH by default, whatever ETH is worth that day), as for WBNB and the
  stablecoins: a bad-price fill inside the cap, as decision 0149 accepts for trades. Spec 5 and ARCHITECTURE section 8 name ETH among the capped tokens.
- Init makes 5 of Privy's 10 aggregations.
- An install whose ceilings name no ETH cap holds no ETH route: custody refuses the ceiling until
  the cap is in it. The same holds for any token a later route takes. Across's plugin answering
  `no_route` for such a route is a courtesy to the owner, not the wall.
- Any other uncapped token a later venue moves keeps decision 0149's wording: it can be sold at any
  price.

## Alternatives

- **Leave ETH routes out of v1.** The owner chose to keep them with a cap.
- **Bind the output amount.** Privy compares a field with a constant only; the signer checks it,
  which a thief holding every key passes by.
- **Size the cap at the day's ETH price.** A ceiling is built before any price is read and the price
  moves. The floor fixes the cap in ETH: at least the nominal dollars while ETH trades above $1,000,
  and more in dollars as ETH rises, as decision 0149 sizes BNB.
