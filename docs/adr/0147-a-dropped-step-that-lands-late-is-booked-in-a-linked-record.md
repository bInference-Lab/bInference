# 0147. A dropped step that lands late is booked in a linked record

Status: Accepted

## Context

[Decision 0115](../DECISIONS.md#d0115) drops a stuck step once every relay turned it away and its
nonce is still free, and ends its intent `failed_onchain` with `stuck_dropped`. A relay or a node
the drop rule cannot see may still hold the transaction, and it can land after the drop. The
executor watches dropped transactions for 600 blocks and alarms the owner when one lands, but the
trade then moved funds that the positions, the realized P&L and the rolling 24-hour cap
([decision 0136](../DECISIONS.md#d0136)) left out, since a `failed_onchain` intent counts as one
that moved nothing. Nothing leaves a terminal state (spec 6, invariant 1).

## Decision

- The intent stays terminal and unchanged. A new record, a late landing, links the intent to the
  transaction a block holds, the way a ledger books a correction as its own entry.
- The late landing is stored at once, in the new `late_landings` table of `engine.sqlite`, one
  per intent. The rolling 24-hour cap counts an intent that has one again, at its judged value
  from its confirmation.
- Once every step of the plan is in a block that ran it and those blocks are final, the trade is
  booked into the positions and realized P&L as a reconciliation books it, once. A landing whose
  other steps never ran, or whose block a reorg moved, keeps its record and its alarm, and books
  nothing into the positions.
- The owner's alarm `notice.droppedLanded` stays, and now says the trade was counted.

Accepted by the owner on 2026-10-11.

## Consequences

- Migration `0020_late_landings` adds the table; the intent store gains `recordLandedLate`, and
  `confirmedSince` gives each intent's landing time.
- Spec 6 sections 6 and 9 and the database spec describe the record.
- A late landing is found only within the 600-block watch after the drop.

## Alternatives

- **Move the intent out of `failed_onchain`.** It breaks the invariant that nothing leaves a
  terminal state, and the ledger would hold two endings for one intent. Rejected.
- **Only alarm.** The cap and the positions would stay wrong until the owner corrects them by
  hand. Rejected by the owner.
- **Keep the intent `executing` until the watch ends.** The owner would wait 600 blocks to learn a
  trade did not go through. Rejected.
