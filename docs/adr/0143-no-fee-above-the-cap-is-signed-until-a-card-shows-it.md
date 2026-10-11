# 0143. No fee above the cap is signed until a card shows it

Status: Proposed

## Context

[Decision 0102](../DECISIONS.md#d0102) lets a tap pay a fee per gas above the chain's network fee
cap, because the card shows that fee. No card shows a fee per gas today: the card has no fees line
yet, and nothing stores the fee per gas read when the steps were built. The executor read the fee
again from a public RPC endpoint at each step and replacement, and refused one above the cap only
for an auto intent. A broken or hostile endpoint that answered 1,000 gwei made a tapped swap pay
about 0.2 BNB in fees on BNB Smart Chain, a fee no card showed. The signer checked no fee for a
tapped intent, and none for a cancel under an auto grant.

## Decision

- Until a card shows a fee per gas, the most any transaction pays per gas is the chain's network
  fee cap, tapped or not.
- The executor refuses a fee above the cap when the queue takes an intent, at each later step and
  at each speed-up or cancel. At the take, the intent stays `confirmed`, leaves the queue and tries
  again a block later, until the fee falls or its confirmation or auto grant runs out and it
  expires with `notice.confirmationLapsed` ([decision 0120](../DECISIONS.md#d0120)). A later step
  above the cap ends the intent as a step never signed
  ([decision 0109](../DECISIONS.md#d0109)); a replacement above it hands the step over
  ([decision 0115](../DECISIONS.md#d0115)).
- The signer's rule 5 refuses any transaction whose fee per gas is above the chain's cap in its
  settings, whatever authorized it.
- Once a card shows the fee per gas, the confirmation stores the fee it showed, the signing request
  carries it, and the most a tapped transaction pays becomes the larger of the cap and that fee. That
  change needs its own decision.

## Consequences

- During a fee spike above the cap, a tapped trade waits up to its card's minute and then expires
  with a notice, as an auto trade already did. The owner can raise
  `chains.maxFeePerGasGwei.<chain>` and propose it again.
- Decision 0102's line "the signer's hard rules do not check the fee" no longer holds; 0102 becomes
  "Amended by 0143" once this is accepted.
- Spec 6 sections 5 and 6, and spec 5 rule 5, say so. A cap the owner changes while the engine runs
  reaches the signer at its next start; until then the signer refuses a fee above the older cap.

## Alternatives

- **Store the fee per gas read at the proposal and allow up to it.** No card shows that number, so
  the owner never saw it. Rejected until the card's fees line shows it.
- **Check the fee in the executor only.** A faulty engine could still have any fee signed. Rejected.
- **Refuse the intent at the take for good.** A short spike would end every tapped trade at once.
  Rejected: waiting for the fee to fall while the confirmation lasts costs nothing.
