# 0099. A freeze leaves a pending rescue

Status: Accepted

## Context

[Decision 0093](../DECISIONS.md#d0093) accepted spec 6 with the rule that a freeze cancels every
unsigned intent. [Decision 0044](../DECISIONS.md#d0044) says a rescue sends every token and the BNB
to the rescue address after one tap, even when frozen. A rescue that waits for its tap, or for the
wallet queue after it, is unsigned, so the two rules disagree: the freeze an owner sends when
something is wrong would cancel the rescue meant for that moment.

## Decision

A freeze cancels every unsigned intent except a rescue. A pending rescue keeps its state and its
card. A cancel request and the engine stopping still cancel it, as they cancel any unsigned intent.

A rescue pays only the owner's own rescue address, which takes 24 hours to change, so a rescue
left open moves nothing to anyone else.

## Consequences

- Spec 6 says so in its transition table and in its rescue section.
- The engine's cancel guard refuses a freeze's cancel of a rescue, and a property test checks that
  no freeze cancels one.
- A freeze still cancels every other unsigned intent at once and never interrupts an intent that is
  executing.
- Decision 0093 keeps its text, with the status Amended by 0099.

## Alternatives

- **A freeze cancels the rescue too, and the owner starts a new one.** One more step at the worst
  moment, and the new card waits for a tap again. Rejected.
- **A freeze waits while a rescue is pending.** A freeze must take effect at once. Rejected.
