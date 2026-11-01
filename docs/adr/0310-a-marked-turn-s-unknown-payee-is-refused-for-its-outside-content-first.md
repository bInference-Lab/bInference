# 0310. A marked turn's unknown payee is refused for its outside content first

Status: Accepted

Accepted by the owner on 2026-11-01 ("Outside content").

## Context

Spec 6, section 4, lists the policy's reasons in the order it stores the first one broken:
`send_level`, then `unsaved_address`, then `outside_content_send`. Since
[decision 0091](../DECISIONS.md#d0091), every send to an address outside the address book is also
unsaved, so a send or a bridge from a turn with the outside-content mark always stored
`unsaved_address`. The owner and the agent never saw that the address came from outside content,
which is the reason that matters: rule 13 marks such a turn so that nothing it read can choose a
payee.

## Decision

- `outside_content_send` comes before `unsaved_address` in spec 6's order. A send or a bridge from
  a marked turn to an address outside the address book stores and shows `outside_content_send`.
- Every other order stays. A send at level 3 still stores `send_level` first, and an unmarked send
  to an unsaved address still stores `unsaved_address`.

## Consequences

- The verdict's full list still names both reasons; only the first, which the intent stores,
  changes.
- An agent told `outside_content_send` learns to ask the owner for the address rather than to save
  it.

## Alternatives

- **Keep the order.** The mark is never the stored reason, so it tells no one anything. Lost
  (owner).
- **Put `outside_content_send` first of all.** A frozen agent or a level 3 send would hide behind
  it, though those refuse every send. Lost.
