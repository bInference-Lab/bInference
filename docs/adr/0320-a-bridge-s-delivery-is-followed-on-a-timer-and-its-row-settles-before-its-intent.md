# 0320. A bridge's delivery is followed on a timer, and its row settles before its intent

Status: Accepted

Accepted by the owner on 2026-11-01.

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
reads every bridge's delivery on its destination chain, marks it late after 2 hours and never
ends it unread. The database spec opened a bridge's `bridges` row with its departures in one
transaction, and moved the intent to `reconciled` in the same transaction as the row's settling
move. Three things that spec left open:

- What reads a bridge in transit, how often, and in which order.
- How a stop between the writes of a settling is repaired: the departures and the row live in the
  position and bridge stores, the move in the intent store, and an arrival for a refund in the
  position store again. Joining them would make each store write the others' rows.
- What the late notice names when the venue's status page cannot be read.

## Decision

- **The row opens after the departures.** The executor's reconciliation of a final bridge stores
  its departures once, then opens its row in transit once, with the deposit's transaction and the
  time its block became final. A stop between the two opens the row at recovery, which reconciles
  the bridge again.
- **A timer follows it.** The composition root runs the engine's follower every 30 seconds. Each
  pass reads the next 100 bridges in transit or late, oldest deposit first, one at a time, and
  starts again from the oldest once it read the last, so no row starves the others: the venue's
  status within 10 seconds, then the reads it names. A venue or a node that fails leaves the bridge
  for the next pass.
- **Only the deposit's own settlement counts.** The venue's status names where to read, never what
  happened. The follower reads the deposit's own transaction on the source chain and the named
  fill or refund, each final, with the events the chain's delivery reader returns, and the venue
  matches them from the events alone (the `Bridge` port's `settlement`): for Across, the source
  SpokePool's `FundsDeposited` from the wallet, of exactly the amount, to the recipient, then the
  destination SpokePool's `FilledRelay` naming that deposit's id, origin chain, depositor,
  recipient and output token. What arrived counts no more than the venue says this deposit was
  paid, so a transaction that paid others counts only this deposit's share. A bare transfer is
  never a settlement.
- **A refund names no deposit.** Across pays an expired deposit back in a relayer refund leaf on the
  source SpokePool that sums each address's refunds and names no deposit id. A leaf counts for a
  deposit only when it pays the depositor at least its input, in its token, not deferred, and then
  pays back the input alone; the engine never books more than the deposit sent.
- **One settlement settles one bridge.** `bridges` holds unique indexes on `(to_chain, fill_tx)` and
  on `refund_tx`. The follower settles nothing with a transaction another row holds; a relayer that
  fills or refunds two of the agent's deposits in one transaction settles the first, and the second
  waits, late, for the owner, who reads it on the venue's page.
- **Settling.** The follower alone records refunds, one bridge at a time: a refund's arrival first,
  once by its transaction among the wallet's arrivals since the deposit, then the row under its
  version, then the intent's move to `reconciled`. The writer whose intent move landed, the
  follower's or recovery's, alone tells what the receipt does not (`notice.bridgeArrived`,
  `notice.bridgeRefunded`). A stop after the row moved leaves recovery to move the intent and tell
  the owner; a stop before it leaves the arrival found by its transaction on the next pass.
- **A bridge the queue holds.** A confirmed bridge its queue checks hold (decisions 0318 and 0319)
  stays `confirmed` and is checked again each block. When its confirmation runs out it expires
  with `notice.bridgeLapsed`, which says what held it, read again then: the rescue address first,
  then the policy, then the quote's age.
- **The late notice** goes with the venue's status page from that pass's status, so a bridge
  whose venue does not answer is marked late at the first pass that reads its status.
- **A dropped deposit that lands after all** (decision 0147) takes the amount sent and its gas
  out of the positions as departures, once, and books no trade; one that reverted takes only its
  gas and the approval's, never the amount. Its intent stays `failed_onchain`, so no row opens and
  nothing follows its delivery.
- **Its value** in transit is left unset when the row opens: the positions task values the units
  sent.

## Consequences

- A bridge settles up to 30 seconds after its delivery is final, plus its reads.
- With more than 100 bridges in transit, each is read every few passes rather than every pass.
- Each settled bridge costs two more reads: the deposit's transaction and the settlement's events.
- The owner hears of a late deposit through the dropped step's own notice and finds its delivery
  on the venue's status page; the engine does not read it.
- Spec 3's "in the same transaction" for a bridge's opening and settling reads as this order.

## Alternatives

- **One transaction across the stores.** The bridge store would write positions and intents, or
  the intent store bridges and positions: one owner per responsibility breaks. Lost.
- **Read every bridge at once.** A burst of 100 status calls and 200 node reads each pass. Lost.
- **Trust the venue's status, or a transfer to the recipient.** Anyone can pay the recipient, and a
  status can name another deposit's fill. Lost; the deposit's own events decide.
- **Mark late without the status page.** The owner would get a notice with nowhere to look. Lost;
  the status page is the venue's own answer.
