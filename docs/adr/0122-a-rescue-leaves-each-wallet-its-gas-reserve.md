# 0122. A rescue leaves each wallet its gas reserve

Status: Accepted

## Context

[Decision 0044](../DECISIONS.md#d0044) sends "the BNB (minus gas)" of every agent wallet to the
rescue address, and [decision 0045](../DECISIONS.md#d0045) keeps a gas reserve that trades never
spend: 0.002 BNB by default. The card fixes the exact amount of each send, and the signer checks it
(hard rule 3). The gas a send costs is known only when the step is prepared, after the card, and a
stuck rescue step needs gas again for its replacement (spec 6, section 6). The owner decided on
2026-10-10.

## Decision

A rescue sends each wallet's native coin above its agent's gas reserve on the chain, after the
wallet's tokens. The reserve stays in the wallet and pays the rescue's own fees, a replacement of a
stuck step and a retry. A wallet whose coin is at or below its reserve sends no coin.

## Consequences

- The amount of the coin's send is fixed when the rescue is planned and shown on its card.
- About 0.002 BNB per wallet, less the rescue's fees, stays behind. The ceiling lets that coin pay
  only the rescue address or a saved address, so a hijacked machine cannot send it elsewhere.
- An agent whose reserve is 0 leaves nothing to pay the coin's send, which then fails and is
  retried as any failed step.

## Alternatives

- **Send the balance less the most the send can cost, computed as the step is prepared.** It
  needs the preparer to sweep, and leaves no gas for a replacement or a retry. Rejected.
- **Reserve a fee estimate from the simulation.** The estimate would need a margin chosen by
  hand. Rejected.
