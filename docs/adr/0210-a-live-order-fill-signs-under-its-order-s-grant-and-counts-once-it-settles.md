# 0210. A live order fill signs under its order's grant and counts once it settles

Status: Amended by 0211

Accepted by the owner on 2026-10-13.

## Context

[Decision 0197](0197-an-order-re-arms-after-a-fill-holds-its-level-and-judges-prices-in-block-order.md)
keeps live fills off and lists what must hold before they turn on: the order's move and row
written in the executor's reconcile transaction; the fill's line held until the intent settles; a
lapse for a confirmed live fill; no live intent cancelled by the fill runner; signing terms for a
fill in the wallet queue; and the crash suite on fills. The state before this decision:

- Only a paper fill writes its order. A live fill went to the executor and nothing counted it, so
  a stop-loss with one fill would fill again at the next price.
- The fill runner released the agent's line when the executor took the fill, and cancelled a live
  fill still `confirmed`, as if it were a paper one, though the executor may sign it then.
- A live fill never lapsed in its wallet's queue.
- The queue gave a fill no signing terms, and the signer's rule 5 (keys spec, section 5.2) checked
  an order's state and fills but bound no intent, no terms and no amount.
- A fill's transaction lands whatever its order became after it was signed: an owner can cancel
  the order, a freeze pauses it, its expiry can pass. A transaction a relay dropped can land up to
  600 blocks later, after its intent ended `failed_onchain`.
- The signer sees each step's call: a call's native value, or an approval's token and amount, which
  rule 3 holds to the transaction. It does not read a venue's swap calldata.

## Decision

- **The fill grant.** A live fill signs under a grant the engine makes from the stored fill as
  the queue takes it, as an auto grant is made: the fill intent; its order; the SHA-256 of the
  order's confirmed card terms; the fills the order had when the fill was proposed, stored with the
  fill's authorization; the fill's own terms hash over the intent, the order, those two, the
  request, the quote and the plan; when it was confirmed; a trade card's lifetime, 60 seconds; the
  chain's network fee cap; and what the fill spends, the coin or a token by its contract, with its
  confirmed quote's input as the most. The engine reads the order again right before each
  signature and sends it with the grant.
- **Rule 5 for an order fill.** The signer signs a fill's step only when the grant names the
  request's intent and terms and the order as it stands; that order holds the same confirmed card
  terms, is `active`, before its expiry, with a fill left and with exactly the fills it had when
  the fill was proposed; the fee per gas is at most the grant's cap; the step spends at most the
  grant's most of the fill's asset, a call's native value for the coin, an approval's amount for
  the token, and no call sends coin while the fill spends a token; and the grant has not expired. A
  send is never a fill's. A cancel of the fill's own transaction signs whatever the order became,
  up to a minute after the grant expired, as a confirmation's does (decision 0116). The swap call's
  token amounts are bound by the fill's terms hash and rule 3, not read by the signer.
- **One fill of an agent at a time, across restarts.** No fill of an agent starts while one of
  its live fills is `confirmed`, `executing`, `included`, `finalized` or `unknown_after_send`; the
  trigger is judged again at the next price. The check reads the store, so it holds after a stop.
  The fill runner never cancels a live fill the executor took. An order whose stored trigger state
  is disarmed fires nothing, so a trigger that judged an older copy before a live fill was counted
  does not fill it again.
- **A lapse.** A confirmed live fill that waits in its wallet's queue past its grant expires, with
  `notice.confirmationLapsed`, and its order records the skip `fill_lapsed`; the order stays active.
- **Counted once it settles.** The move of a live fill to `reconciled` writes, in its own
  transaction, a new order move `fill_landed`, the fill's `filled` row with its notices, and the end
  of the other exit orders of a position its sale emptied, read from the live positions after the
  trade. `fill_landed` counts the fill whatever the order became while the fill was under way: an
  active order as a recorded fill does, at any time; a paused order stays paused; an order that
  ended keeps its state and counts it. That count is the only move of an ended order the stores
  allow. A dropped step that lands later counts on its order the same way. A move that loses a race
  to another write of its order is tried again at the next block.
- **Other ends are skips.** A live fill that fails on chain records its failure reason, one never
  signed records `fill_failed`, and one whose grant lapsed `fill_lapsed`, each row written with the
  move that ends the intent. The executor's own notice tells the owner, so the row carries none.
  At the start, a live fill a stop left before its confirmation is cancelled unsigned and records
  `fill_failed`.
- **The money path's own refusal.** While the engine's switch for live fills is off, the
  authorization at `simulated` ends a live fill `failed_check` with `live_fills_off` before its
  check runs, whatever proposed it, beside the fill runner's skip and `order/create`'s refusal.
- **The crash suite.** It kills `binference start` during a live limit order's fill, with prices
  firing the order at every block before and after the stop: as custody is asked to sign, once it
  signed, once the bytes are stored, while the transaction waits for a block, and once a block
  holds it. Each run passes when one transaction reached the chain and the order counts one fill.
  Only the suite's engine turns live fills on, through a field of the test host the entry file
  never sets.
- **Still off.** The switch stays off and `order/create` keeps refusing live price orders; turning
  them on is the owner's decision.

## Consequences

- A live order fill can fill once per authorization: the grant dies once its order counts any
  fill, so a fill signed late, or a second fill under the same count, signs nothing.
- An agent's live fill holds all its fills for the few blocks to finality; another order of the
  agent fires at the next price after it.
- Spec 5's rule 5 names the fill grant; spec 6 gains the skip reason `fill_lapsed`, the fill
  reason `live_fills_off`, the lapse of a fill, the record at reconciliation and the start's
  cancel of an unfinished live fill.
- `binference check` warns, as `rpc.pushed`, while a live order waits on blocks polled over HTTP
  ([decision 0209](0209-a-recorded-day-replays-on-today-s-pools-to-time-exit-fills-by-block.md)).
- The token launch steps of the crash suite are not in it yet.

## Alternatives

- **Count the fill at signing.** A fill that reverts or is dropped would use the order's fill.
  Rejected for the count at reconciliation, with the line held until then.
- **Hold the line in memory only.** A restart would forget it while the fill is still in flight.
  Rejected for the check in the store.
- **Cancel the order's fill when the owner cancels the order.** A signed transaction cannot be
  called back; a cancel at its nonce costs a fee and may lose the race. Rejected: the cancel stops
  every signature from then on, and a fill already signed still counts.
- **Let the signer read the swap calldata.** Every venue encodes its calls its own way; the
  signer would carry each venue's decoder. Rejected for the terms hash and rule 3.
