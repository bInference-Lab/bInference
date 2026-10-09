# 0126. A rescue signs its unsent steps after a restart while its confirmation lasts

Status: Accepted

## Context

[Spec 6, section 7](../specs/intent-states.md#section-7) says recovery never signs, and that a step
with no stored transaction ends the intent. [Decision 0109](../DECISIONS.md#d0109) adds that a
rescue retries instead. A rescue stopped part way would otherwise stay `executing` with funds left
in its wallets. The owner decided on 2026-10-10.

## Decision

At start, a rescue a stop left `executing` goes on from where it stood: a step a block holds is
done, a step signed or sent goes on with its own stored bytes and is never signed again, and a step
with no stored transaction is signed as at its first run. The signer signs it only while the
owner's confirmation lasts (hard rule 5); once it has run out, the step fails and the rescue
reconciles with what landed. A rescue left `included` or `finalized` settles as any intent.

## Consequences

- Spec 6, section 7 names the exception: recovery never signs, except a rescue's unsent steps.
- A restart within the rescue's confirmation finishes it; a later one ends it with what moved, and
  the owner asks for a new rescue for the rest.
- No step is ever signed twice: a stored transaction is always followed by hash and nonce.

## Alternatives

- **Leave the rescue `executing`.** Funds stay behind and no new rescue can start
  ([decision 0125](../DECISIONS.md#d0125)). Rejected.
- **End the rescue at start.** A restart moments after the tap would drop the rest of the rescue.
  Rejected.
