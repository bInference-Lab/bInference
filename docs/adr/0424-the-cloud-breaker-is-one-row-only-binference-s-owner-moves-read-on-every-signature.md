# 0424. The Cloud breaker is one row only bInference's owner moves, read on every signature

Status: Accepted

Accepted by the owner on 2026-11-12.

## Context

bInference Cloud keeps a global breaker that freezes every Cloud agent (ARCHITECTURE.md section
30): it follows a freeze's rules on every agent, cancelling everything unsigned and letting a sent
transaction finish ([decision 0093](../DECISIONS.md#d0093)), and a freeze keeps a rescue
([decision 0099](0099-a-freeze-leaves-a-pending-rescue.md)). The signer service must refuse while it is pulled, so a
worker that missed it still cannot sign. Only bInference's owner, the person
who runs bInference and not an agent's owner, pulls and lifts it; lifting it leaves each user's
own freeze. Where its state lives and how each part reads it is not set.

## Decision

- The breaker is one row of the shared schema, `cloud.breaker`: `pulled` (0 or 1), `changed_at`,
  `changed_by` (who, from the operations control's sign-in), `reason` and `version`.
- A role of its own, `binference_ops`, may update that row and nothing else, and only the operations
  control, under bInference's owner's sign-in with a second factor, connects as it.
- The signer service reads the row in every request's check transaction. While it is pulled, it
  answers `locked` with `breaker` to every request but a step of a rescue intent that pays the
  rescue address in effect, with that rescue's speed-ups and cancel; a row it cannot read answers
  `down`.
- The workers read the row too and freeze every agent they hold while it is pulled, with a
  freeze's rules: everything unsigned is cancelled but a rescue, which goes on. Lifting it ends only
  the breaker's freeze.

## Consequences

- Pulling the breaker stops every Cloud signature but a rescue's within one request, whatever the
  workers do.
- A user can still move every wallet's funds to their rescue address, as during their own freeze;
  the rescue address only binference.io sets, and the ceiling pays no other.
- Each pull and lift names who made it and why in the row, and the operations control logs every
  change.

## Alternatives

- Refuse everything while it is pulled, a rescue among them: a user could then reach their funds
  only through Privy itself, while a rescue pays only the address the user set on binference.io.
- A flag in the signer service's settings: pulling it needs a deploy, which takes minutes.
- Disabling the KMS key: it stops signing too, but it needs the key's break-glass role, and the
  service then reads as down, not braked. It stays the last resort.
- A feature-flag service: one more system that must answer before every signature.
