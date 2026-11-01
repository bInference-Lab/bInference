# 0323. A Relay quote is taken only for its own order, and a fill counts by Relay's events

Status: Accepted

Accepted by the owner on 2026-11-01: EVM fills matched by Relay's solver, the amount and the saved
address; two of the agent's own bridges of one token to one address may settle against each
other's fills; Solana fills matched by the order's memo. For the swaps into USDG the owner chose
"Show it, cap 0.5%" the same day: the swap's rate shows on the card as its own line and keeps at
most 0.5%. This decision amends
[decision 0303](0303-relay-deposits-run-only-from-a-bridge-wallet-the-owner-funds-from-outside.md):
the depository's `depositNative` is no longer declared.

## Context

[Decision 0317](0317-a-bridge-deposit-decodes-as-bound-or-as-an-order-and-a-quote-builds-only-for-its-own-request.md)
lets Relay's deposit decode as an order deposit, which names only its depositor, its input and an
order id, and keeps the bridge wallet rule as its safety. [Decision 0320](0320-a-bridge-s-delivery-is-followed-on-a-timer-and-its-row-settles-before-its-intent.md)
counts a fill or refund only by the chains' own events, matched to the deposit by the venue.

Relay's input validation guide, read on 2026-11-01, says how to check a quote locally: read the
recipient, the least output, the tokens, the chains and the deadline from the quote's
`protocol.v2.orderData`; work out the order id from that data, an EIP-712 struct hash with each
address as its chain's bytes; check that the deposit pays the canonical depository, names that
id and moves exactly the order's input; and check `protocol.v2.orderSignature`, an EIP-191
signature over the id's 32 bytes, against a solver address the client holds. Working it out here
gave the id Relay named for each recorded quote, to Base, to Solana and to Robinhood Chain, and
each signature recovered to Relay's solver `0xf70d...dbef`, which its contract addresses page
lists.

Every recorded order, read on 2026-11-01, wrote each refund with a least amount of 0 and the
output's deadline, `solverChainId` `base`, and as extra data on each EVM leg one 32-byte word
naming a Relay contract, on a Solana leg none. The docs describe none of these fields. The two
quotes to Robinhood Chain fill USDG by a swap: their output was 2,853 and 24,500 base units under
the input less the solver's fees, at the rate of USDC or USDT to USDG, 0.02% and 0.13% of it.

What Relay's transactions leave on chain, read on 2026-11-01:

- The depository's `RelayErc20Deposit(from, token, amount, id)` names the order, whether the wallet
  called the depository or a router did.
- A fill of a dollar on an EVM chain is `transferFrom(solver, recipient, amount)` on the token,
  sent by one of Relay's executors, with the order id appended to the calldata. Its only event is
  the token's `Transfer` from Relay's solver to the recipient. A refund on BSC has the same shape.
  The docs do not describe the appended id.
- A fill on Solana is an SPL transfer by Relay's Solana solver and two Memo program instructions:
  the order id and the request id. The memo lines are the transaction's only logs.
- The delivery reader gives a transaction's events, never its calldata or its signers.
- Recorded and matched here: a USDC fill on Base, a USDC fill on Solana, and a refund on BSC paid
  by the solver. No fill on Ethereum, Arbitrum or Robinhood Chain was recorded, and no refund paid
  by the depository.

## Decision

- **The signature.** A Relay answer is taken only when Relay's solver, the address this plugin
  holds, signed its order id. A missing or other signature is `relay.unsigned_order`, before any
  other check: every term the id commits to is then Relay's solver's word, not only the API's.
- **The quote.** A signed answer is taken only when its order is the one its id names and Relay's
  solver takes; it is paid exactly the input on BSC and pays the asked recipient the asked token on
  the asked chain, its least output equal to its expected output; every refund goes to the wallet
  in the token it sent on BSC, or to the recipient in the token it would get on the destination;
  Relay's payment and the deposit step pay the registry's depository from the wallet, with no coin,
  and name the order; the details name the asked tokens with the registry's decimals; every fee is
  in the token that leaves, with no app fee, and the output is exactly the input less the solver's
  fees, so the fees a card shows are what Relay keeps at most; on a route the registry marks as a
  swap into another token, the output may miss the input less the fees, a dollar counted as a
  dollar, by at most the route's cap; and the terms no ask names are as
  Relay writes them: the solver settles on a chain Relay lists, every refund holds as long as the
  output, and each leg's extra data is empty or Relay's word. Anything else is `relay.bad_quote`,
  naming which check failed. Refunds' least amounts are not checked: Relay writes 0 in every
  order, so what a refund returns rests on Relay. The quote's record keeps what was asked, the order
  id and its least output; a build for another request is `relay.quote_mismatch`, and the deposit
  is encoded here.
- **The settlement.** The deposit's own `RelayErc20Deposit` from the depository, from the wallet,
  of exactly the token and amount sent, names the order. On Solana a fill counts only when a Memo
  program line names that order, and then counts all the transaction brought the recipient; the
  sender is not checked, since the delivery reader gives only the memo lines. On an EVM chain,
  where no event names the order, a fill counts what Relay's solver sent the recipient in the
  delivered token by that token's `Transfer` events, never more than the least output, and a refund
  what it sent the wallet back in the token sent, never more than the deposit. On an EVM chain a
  transfer from anyone else is never a settlement.
- **The declaration.** Relay declares only the depository's `depositErc20`, its depositor pinned
  to the wallet, a bridge wallet's alone. No route leaves as a coin, so `depositNative` is not
  declared, and no ceiling lets a bridge wallet's gas go into Relay. The signer holds only the
  depositor: the port's bridge marks name a bound deposit's recipient, chain, tokens and least
  output, which an order deposit lacks, and holding its token, amount and order id would need a
  mark of its own through the port, the engine's plan and the signer. The bridge wallet rule bounds
  what a compromised engine could deposit to what the wallet holds and approved (decision 0303).

- **The swap's rate.** The registry marks each route a bridge fills by a swap into another token
  with its cap, `swapCapBps`: 50 basis points on Relay's two routes to USDG on Robinhood Chain.
  On such a route the engine works the rate out from the quote itself: the input less the fees at
  the arriving token's decimals, one to one, less the least output, as a share of the input less
  the fees, rounded up to a whole basis point. A quote whose rate is over the cap is refused with
  `swap_rate`, its own reason and words in English and Chinese, before the agent's slippage floor,
  which the rate and the fees count against together (`price_impact`). The card shows the rate on
  its own line after the fees (`card.bridge.swapRate`, "Swap rate: 0.13%"), and the card's terms
  hash binds it. Every route the registry does not mark keeps the equality.

## Consequences

- Relay's off-chain order is checked before any card: a lying answer cannot move the recipient,
  the chain, the token or the least output without changing the id the deposit names, and only
  Relay's solver can sign another id.
- A bridge to USDG on Robinhood Chain shows Relay's swap rate beside its fees, and Relay can keep
  at most 0.5% beyond them by that rate; a worse rate ends the bridge `swap_rate` before its card.
  The cap lives in the registry beside the route, not in config.
- Same-token routes, Relay's and Across's, keep the strict equality: no rate shows on their cards.
- On an EVM chain the bridge cannot tell one Relay fill to the recipient from another of the same
  token. The status names the fill, and decision 0320's unique fill index lets one transaction
  settle one bridge; two of the agent's Relay bridges in transit to one saved address in one token
  could settle against each other's fills, each still the owner's funds at the owner's address. A
  fill counts no more than its least output, so a batch that paid two orders never books both.
- A Solana fill that paid two orders to one recipient in one transaction counts all it paid toward
  the first bridge that reads it; the second waits, late, for the owner.
- A fill on Ethereum, Arbitrum or Robinhood Chain, or a refund the depository pays, follows a shape
  no recording proves. One from another address than Relay's solver reads `not_own` each pass, and
  its bridge goes late with its notice.

## Alternatives

- **Trust Relay's status for the order.** The status would decide whose fill it was. Rejected.
- **Trust the API's order without the signature.** An API that lied could describe any order it
  liked with a matching id. Rejected.
- **Read the order id from the fill's calldata.** It would bind an EVM fill to its order, but it
  needs the delivery reader to return calldata, and Relay does not document the appended id.
  Left until Relay documents it.
- **Count only the least output on Solana.** A fill above the least would read as less than it
  paid. Rejected.
- **Check only the deposit, not the order.** The deposit names an id no ceiling reads; without the
  order's own check, Relay's answer alone would say who is paid. Rejected.
- **A signer mark for an order deposit's token, amount and id.** A new mark through the port, the
  plan and the signer, for a loss the bridge wallet already bounds. Left for a later change.
