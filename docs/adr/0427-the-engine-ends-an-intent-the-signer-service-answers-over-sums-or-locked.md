# 0427. The engine ends an intent the signer service answers over_sums or locked

Status: Accepted

Accepted by the tech lead on 2026-11-12. Changes spec 5, section 8.7, which the owner approved
with decisions 0419 to 0425: there a `locked` answer left the intent waiting.

## Context

The signer service answers `over_sums` when a step would pass the user's 24-hour sums and
`locked` while the breaker is pulled or its key or Privy app does not check out
([decision 0425](0425-the-signer-service-answers-each-request-once-and-keeps-an-audit-line.md)).
The `Signer` port gains both refusals. The executor asks for a signature only after it moved the
intent to `executing` (spec 6, section 3), and spec 6, section 7, item 4 ends an intent whose step
cannot be signed, or whose signer fails as it signs: `cancelled` when no step was signed,
`failed_onchain` with `step_unsent` once an earlier step landed (decision 0109). Spec 5, section
8.7 has `locked` leave a confirmed intent waiting, as a locked engine does; by then the intent is
`executing`, and no move takes it back to `confirmed`. Spec 6 stores no reason that tells the user
why a signer service refused.

## Decision

- **Both end the intent** as a step that was never signed (spec 6, section 7, item 4), through the
  existing `step_unsent` move: `cancelled` when no step was signed, `failed_onchain` once one
  landed. The executor never asks again for that step: a refusal is a decision, not a fault.
- **Each stores its reason.** `day_sums` for `over_sums` and `signer_locked` for `locked` join the
  failure reasons, in the place of `step_unsent`, on both moves.
- **The user is told.** `over_sums` raises `notice.daySums` with the cap, what is used, the chain
  and when room frees, in the place of `notice.notSigned` or `notice.stepUnsent`. `locked` raises
  those two as any unsigned step does; the breaker's own notice tells why it is pulled.
- **A rescue** keeps its own rules (spec 6, section 5): a step it could not sign is tried again a
  block later, three tries at most, then the rescue reconciles what landed. The service never
  answers `over_sums` to a send ([decision 0426](0426-a-cloud-user-s-24-hour-sums-count-a-send-but-never-refuse-one.md))
  and keeps rescues while the breaker is pulled, so only a key or app check meets one.
- **Spec 5, section 8.7** changes to match: `locked` ends the intent as `over_sums` does.

## Consequences

- A refused step costs the user a new card once the room frees or the lock lifts, as a signer
  refusal does on self-hosted.
- The state machine keeps the moves it has; only the stored reason and the notice are new.

## Alternatives

- Leave the intent waiting while `locked`: it needs a new move from `executing` back to
  `confirmed` for a step that was never signed, and the breaker's freeze cancels an unsigned intent
  anyway.
- Ask again each block while the authorization holds, as after `down`: a lock or a full day does
  not pass within a trade card's 60 seconds, and every repeat is a request the service must refuse.
