# 0317. A bridge deposit decodes as bound or as an order, and a quote builds only for its own request

Status: Accepted

Accepted by the owner on 2026-11-01.

## Context

The `Bridge` port quotes a route, builds and decodes its deposit, and tells a deposit's status. Its
first shape required every decoded deposit to name its recipient, its least output and its
deadline from the bytes alone. Two bridges must fit it:

- Across's `depositV3` names the depositor, the recipient, both tokens, both amounts, the
  destination chain and the fill deadline as top-level arguments, which a ceiling binds
  ([decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md)).
- Relay's deposit names only its depositor, the token, the amount and a 32-byte order id; who is
  paid, where and how much live in Relay's off-chain order, so only a bridge wallet may make one
  ([decisions 0303](0303-relay-deposits-run-only-from-a-bridge-wallet-the-owner-funds-from-outside.md)
  and [0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)).
  A Relay adapter could meet the first shape only by repeating the request's recipient, so the
  host's check of what was built would compare the plan with itself.

The second review of the Across plugin also found that a quote's record held only the bridge's own
terms: a 20 USDC quote built a 2,000 USDC deposit whose least output stayed 19.97 USDC, which a
relayer could fill and keep the rest. And a quote over a route's limits read the same as a bridge
serving nothing, so the owner could not tell "send less" from "not now".

## Decision

- **Two kinds of decoded deposit.** `bound`: the contract called, the depositor, the recipient,
  the input, the delivered asset with its least output, and the fill deadline, each read from the
  bytes; the host compares each with the confirmed plan. `order`: the contract called, the
  depositor, the input and the order id, nothing else. The host takes an `order` deposit only from
  a bridge wallet; that check lands with bridge intents.
- **The contract suite states each kind's proof.** Every bridge declares the kind it builds. A
  bound deposit must name the request's recipient, the delivered asset, at least the quote's least
  output and a deadline no earlier than the quote's expiry; an order deposit must name the
  request's depositor and input and an order id. Both name a declared contract.
- **A quote builds only for its own request.** The quote's record keeps what was asked: the wallet,
  the input, the recipient and the delivered asset. A build whose request differs, or whose least
  output is above the quote's, is refused; the suite checks it for every bridge.
- **Typed reasons for no route.** `quote` answers `no_route`, `amount_too_low`, `amount_too_high`
  or `low_liquidity`, each an answer that moves nothing, so the surfaces name the next step in the
  owner's words.
- **The coin a fill may pay.** A quote names `deliveredAsCoin` when a fill pays an account with no
  code the destination's coin in place of the delivered asset, such as ETH for WETH; the delivery
  is read in both ([decision 0301](0301-a-bridge-route-moves-a-dollar-to-a-dollar-or-eth-to-eth-as-the-bridge-s-api-lists-it.md)).
- **The host's own checks.** The least output is the bridge's word alone: the host floors it by its
  own price of the input before a card shows it. The host checks a quote's expiry with its own
  clock, and reads a fill only on the intent's own destination chain.
- **The signer holds the least output.** A deposit's declared inputs name the one a fill pays at
  least, and the signer accepts the plan's least output only on that input.

## Consequences

- Relay's plugin decodes `order` deposits and passes the suite honestly; the bridge-wallet rule,
  not the decoder, keeps its unbound recipient safe.
- A host path that resizes an intent after its quote must quote again: an old quote no longer
  builds.
- Bridge intents must: refuse an `order` deposit from any wallet but a bridge wallet, map
  the four reasons to the owner's words, read the delivery in `deliveredAsCoin` too, floor the least
  output by its own price, and fill the signer's `atLeast` on the declared least-output input.

## Alternatives

- **Keep one shape and let Relay fill the recipient from its API.** The check of what was built
  would compare the plan with the bridge's own memory. Rejected.
- **Bind the request in the host instead of the record.** Every bridge would need the host to
  remember the request beside each quote; the record already travels with the quote. Rejected.
- **One `no_route` for every refusal.** The owner could not tell a limit from a closed route.
  Rejected.
