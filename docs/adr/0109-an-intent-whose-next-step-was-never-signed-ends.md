# 0109. An intent whose next step was never signed ends

Status: Accepted

## Context

An intent in `executing` can stop with its next step never signed: the engine stopped after the
wallet queue took the intent and before the first signature, or between an approval that landed
and its swap; custody refused the signature; a later step would fail when prepared; or an auto
intent's fee per gas rose above the network fee cap before a later step. Recovery never signs
([spec 6, section 7](../specs/intent-states.md#section-7)), and a step built for a trade carries a
deadline of at most 60 seconds, so signing it after a restart would mostly fail anyway. Spec 6 had
no way out of `executing` for such an intent: it stayed there, and the owner was never told.

## Decision

An intent whose next step was never signed, and never will be, ends:

- `executing → cancelled` when no step was ever signed: nothing reached the chain.
- `executing → failed_onchain` with the new reason `step_unsent` when an earlier step landed.

Both send the owner a notice, in English and Chinese. Recovery still never signs, and a rescue,
which retries its steps (spec 6, section 5), stays as it is.

Accepted by the owner on 2026-10-09.

## Consequences

- Spec 6 gains two rows on one trigger, the failure reason `step_unsent`, a fourth rule in
  section 7, and the notices in section 8. Spec 4 gains `notice.notSigned` and
  `notice.stepUnsent`, and `reason.step_unsent`.
- The executor ends such an intent at once when a step cannot be signed or stored, and recovery
  ends one a stop left that way. A stuck step, and a step whose transactions were replaced or
  dropped, keep the intent `executing` for the stuck step's handling.
- An approval that landed stays on the chain after `step_unsent`; the notice tells the owner to
  check the wallet.

## Alternatives

- **Sign the remaining step at recovery while the authorization holds.** Recovery would sign, and
  the step's 60-second deadline has mostly passed by then. Rejected.
- **Leave the intent `executing`.** It never ends, and nobody is told. Rejected.
- **End both cases as `failed_onchain`.** An intent that sent nothing would read as a failure on
  the chain. Rejected.
