# 0116. A stuck step's cancel signs a minute past its confirmation

Status: Accepted

## Context

A stuck step that would fail now gets a cancel: a 0-value transfer to the wallet itself at its
nonce ([spec 6, section 6](../specs/intent-states.md#section-6)). The signer checks it against the
intent's own authorization, and hard rule 5
([keys spec, section 5.2](../specs/keys-and-backups.md#section-5-2)) signed nothing once a
confirmation expired. A swap mostly fails because its deadline passed, and
that deadline is at most 60 seconds after the quote was built, while the card that holds the
confirmation opens after the build and lives 60 seconds. So the cancel comes about when the
confirmation expires, the signer refused it, the stuck transaction kept its nonce, and every later
transaction of the wallet waited behind it. A cancel moves nothing, and the signer already lets a
cancel pass the auto grant's fee cap.

## Decision

Hard rule 5 accepts a cancel of the confirmed intent for 60 seconds after its confirmation expired:
a transaction rule 6 holds as a cancel, at a fee per gas at most the chain's network fee cap
([decision 0102](../DECISIONS.md#d0102)). The signer reads each enabled chain's cap from its
settings line; a chain without one signs no such cancel. Anything else after the expiry is refused
as before.

60 seconds is one trade card's lifetime, a number the spec already holds. On BNB Smart Chain, at
0.45 seconds a block, it covers the first cancel, which comes at most 20 blocks (9 seconds) after
the deadline that never comes after the confirmation's expiry, and two cancels after it, 40 blocks
(18 seconds) apart. A step its cancel cannot move after that ends as dropped
([decision 0115](../DECISIONS.md#d0115)).

## Consequences

- Spec 5 rule 5 names the exception. The signer's README, `AGENTS.md` and the money-path review
  say so.
- `SignerSettings` gains `networkFeeCaps`, each chain's cap in base units; the composition root
  fills it from `chains.maxFeePerGasGwei` when it starts the signer.
- A cancel signed in the window pays at most the cap, so a wrong fee from a node costs little.
- The rule's tests sign a cancel inside the window and refuse one outside it, a speed-up after the
  expiry, a cancel above the cap and one on a chain with no cap; the property test's oracle holds
  the same rule.

## Alternatives

- **Keep refusing after the expiry.** The stuck transaction keeps the wallet's nonce until it
  lands and reverts, or forever. Rejected.
- **A longer confirmation.** It would widen what one tap authorizes for every transaction, not
  only a cancel. Rejected.
- **A window as long as the drop rule, in blocks.** The signer reads no chain and keeps no block
  count; time is what it can check. Rejected.
- **The engine sends the cap with each request.** The signer checks what the engine says; a cap
  set once at start is what the owner configured. Rejected.
