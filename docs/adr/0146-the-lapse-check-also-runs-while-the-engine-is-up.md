# 0146. The lapse check also runs while the engine is up

Status: Accepted

## Context

[Decision 0120](../DECISIONS.md#d0120) expires a confirmed intent whose confirmation or auto grant
ran out while the engine was stopped or locked, at recovery and before the queue takes the
confirmed intents an earlier run left. A running engine can leave an intent `confirmed` too: it
waits behind the wallet's other intents until its confirmation has run out and the queue refuses
it, or no node answers while its first step is prepared. Such an intent stayed `confirmed` until
the next start, and the owner was not told. The notice of 0120 also says the confirmation ran out
"while binference was stopped or locked", which is wrong for these cases.

## Decision

- Whenever the queue does not take a confirmed intent, the executor runs the lapse check of 0120
  on it at once: one whose confirmation or auto grant ran out moves to `expired`, with nothing
  signed.
- One the queue left because no node answered tries again each block until it is taken or its
  authorization runs out. A tapped intent that waited for the fee gets a new card instead
  ([decision 0143](../DECISIONS.md#d0143)).
- `notice.confirmationLapsed` says the confirmation ran out before the trade could go out, in
  every case.

This amends decision 0120. Accepted by the owner on 2026-10-11.

## Consequences

- No confirmed intent waits silently until a restart.
- Spec 6, section 7, item 5 and spec 4's notice text say so.

## Alternatives

- **A timer over every confirmed intent.** The composition has no such timer, and the queue's
  refusal is the moment the lapse matters. Rejected.
- **Keep the old notice text.** It names a stop or a lock that did not happen. Rejected.
