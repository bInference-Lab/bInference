# 0422. Each Cloud user's 24-hour sums are reserved before the key signs

Status: Amended by 0426

Accepted by the owner on 2026-11-12.

## Context

Self-hosted bounds a stolen machine with Privy's 24-hour caps: aggregations that sum the native
coin every transaction sends and the approvals of WBNB, USDT, USDC and ETH, each twice the rolling
day limit at a floor price (spec 5, section 4; decisions
[0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md) and
[0305](0305-a-fifth-24-hour-cap-bounds-the-eth-a-wallet-approves-on-bsc.md)). Privy allows 10
aggregations per app, and one Cloud app serves every user, so Privy cannot keep a user's own sums.
The signer service must keep them, refuse before it signs when a request would pass them, and
refuse everything while their store is down; Privy's caps stay one Cloud-wide backstop.

## Decision

- **What counts.** Per install, which is one user's, and per chain: the native value of every
  transaction the service signs, sends to saved addresses among them; and, for each token the chain
  caps, the amount of every approval of it. A cancel counts nothing. These are Privy's own sums,
  kept per user.
- **Sizes.** Each sum's cap is the install's day cap in dollars at the token's floor price, as
  self-hosted sizes its caps: $1,000 by default, twice the default rolling day limit, so 10 BNB,
  10 WBNB, 1,000 USDT, 1,000 USDC and 1 ETH. The day cap lives in the install's `custody` record,
  which only binference.io writes, and the user changes it there.
- **A Cloud-wide maximum.** During the beta no user's day cap passes $5,000. The maximum is a setting of
  the Cloud deploy, which the signer service and binference.io read at start, and no user or
  install row can change it. binference.io refuses a higher day cap, and the service sizes each sum
  from the smaller of the install's day cap and the maximum, so a row written past it never widens a
  sum.
- **Window.** A reservation counts while it is younger than 24 hours by the database's clock.
- **Reserve first.** In the transaction that checks the lease and the authorization, the service
  sums the install's reservations of the window, refuses with `over_sums` when this transaction
  would pass a cap, and writes the reservation before the key signs anything, so a crash never
  signs uncounted.
- **One nonce, one reservation.** A reservation belongs to one wallet's nonce on one chain and one
  intent's step. A retry, a speed-up or the cancel of that step reuses it, counting the larger
  amount of the two. Another intent's step at that nonce is refused with `nonce_held` while the
  intent that holds the nonce has not ended. Once it ended, as when its step was dropped and the
  wallet queue hands the nonce on
  ([decision 0115](0115-a-stuck-step-every-relay-refuses-is-dropped-and-ends.md)), the
  next step takes a reservation of its own, and both count their 24 hours. The self-hosted signer
  agrees: it keeps no nonce of its own, checks only that a speed-up or a cancel repeats or cancels
  the step it replaces (spec 5, section 5.2, rule 6), and leaves each nonce to the wallet queue.
- **Release.** A reservation is released only when no signature left the service: Privy refused
  and signed nothing, the service withheld the signature after the lease's second read, or a check
  after the reservation failed. A signature that left counts its 24 hours, landed or not, as
  Privy's caps count it; a cancel does not release the step it cancels.
- **Store.** Schema `signer` of the Cloud database, which `binference_signer` alone reads and
  writes, so one transaction holds the lease read, the authorization read and the reservation. With
  the store out of reach the service signs nothing and answers `down`.
- **The user is told** with `notice.daySums`, which names the asset, the chain, the cap, what is
  used and when room frees, and says to wait or raise the day cap on binference.io.

## Consequences

- A Cloud user is bounded as a self-hosted install is, whatever happens to the workers.
- The engine's own rolling cap, half the day cap by default, refuses first in normal use; the
  sums bind when something passed the engine.
- A cancelled step keeps its room for 24 hours.

## Alternatives

- Count dollars instead of units: a price read could fail open or closed at signing, and Privy's
  caps count units.
- Release a step whose nonce a final block shows taken by its cancel: frees room sooner, but it
  needs chain reads in the service and departs from the caps self-hosted users have.
- The sums in a database of their own: no worker could ever reach them, but the reservation and the
  checks would no longer share one transaction.
- A Privy aggregation per user: Privy allows 10 per app.
