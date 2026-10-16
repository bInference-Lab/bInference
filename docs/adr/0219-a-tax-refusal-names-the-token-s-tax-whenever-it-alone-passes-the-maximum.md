# 0219. A tax refusal names the token's tax whenever it alone passes the maximum

Status: Accepted

Accepted by the owner on 2026-10-16.

Amends [decision 0216](../DECISIONS.md#d0216).

## Context

[Decision 0216](0216-a-tax-refusal-names-the-token-s-tax-the-pool-fee-or-both.md) says two things
about a buy whose route keeps a pool fee. Its first rule stores `high_tax` only for "a buy whose
route keeps no pool fee", while a later line says a leg over the maximum on the token's own tax
names `high_tax` "whatever the buy's fee". The risk step followed the first: with a buy tax of 10%,
a pool fee of 2% and a maximum of 5%, it refused with `high_tax_with_pool_fee`, whose words say the
fee mattered, though the token's tax alone was over.

## Decision

- A transfer, a sale or a buy whose own tax is above the agent's maximum tax stores `high_tax`,
  whatever fee the buy's route keeps.
- A buy whose own tax is within the maximum, and which passes it only with its route's pool fee,
  stores `high_pool_fee` when the token takes no tax on a buy, and `high_tax_with_pool_fee`
  otherwise.

## Consequences

- The refusal names the pool fee only when the fee took the buy past the maximum.
- The same trades are refused at the same maximum; only the stored reason of a buy whose own tax
  is over changes.
- The property test of the risk verdict checks these two rules against random taxes, fees and
  maximums.

## Alternatives

- **Keep the first rule.** A buy whose own tax is over would read as a fee problem. Rejected.
