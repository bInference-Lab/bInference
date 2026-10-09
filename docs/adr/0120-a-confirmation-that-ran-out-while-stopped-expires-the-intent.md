# 0120. A confirmation that ran out while stopped expires the intent

Status: Accepted

## Context

The wallet queue takes a confirmed intent only while its confirmation, or its auto grant, has not
expired ([spec 6, section 3](../specs/intent-states.md#section-3)). An intent the owner confirmed
moments before a crash, or while the engine was locked, waits for the next start or the unlock
([decision 0103](../DECISIONS.md#d0103)). A trade card's confirmation lasts 60 seconds, so by then
it has mostly run out: the queue refuses the intent, and spec 6 had no way out of `confirmed` for
it. It stayed there, and the owner was never told.

## Decision

- When the executor recovers at start, and before it takes the confirmed intents an earlier run
  left, every `confirmed` live intent whose confirmation or auto grant has expired moves to
  `expired`. Nothing is signed.
- The owner gets `notice.confirmationLapsed` for it, which says the trade was not sent because
  its confirmation ran out while binference was stopped or locked.
- An intent an auto order or a webhook rule authorized is left to its order or rule.

Accepted by the owner on 2026-10-09.

## Consequences

- Spec 6 gains the row `confirmed → expired` on the trigger `authorization_lapsed`, and spec 4
  gains `notice.confirmationLapsed`.
- An owner who still wants the trade proposes it again.

## Alternatives

- **Sign it anyway at recovery.** The owner's confirmation no longer holds, and the signer refuses
  it (hard rule 5). Rejected.
- **Cancel it.** `cancelled` reads as the owner's or a freeze's choice, not as time running out.
  Rejected.
- **Leave it `confirmed`.** It never ends, and nobody is told. Rejected.
