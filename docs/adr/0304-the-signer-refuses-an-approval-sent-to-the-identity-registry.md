# 0304. The signer refuses an approval sent to the identity registry

Status: Proposed

Proposed with the lead's ruling of 2026-10-31: the identity registry stays out of the approval rule
and the signer refuses `approve` on it.

## Context

The ERC-8004 identity registry on BNB Smart Chain is an ERC-721 contract: registering mints the
agent's identity token to the caller. Its `approve(address to, uint256 tokenId)` has the selector of
ERC-20's `approve(address spender, uint256 amount)`, `0x095ea7b3`, and the same encoding.

The ceiling's approval rule ([decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md))
allows an `approve` on any contract, so a wallet can approve any token it holds for a sale, as
long as the spender is one a venue declares. It names no token. So it would also let the identity
token be approved to a declared spender, such as a router whose swap pulls its input token with
`transferFrom`, which on the registry would move the identity token.

Privy's docs list a `neq` operator. Its API refused it on 2026-10-31 ("Invalid enum value. Expected
'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'in_condition_set' | 'contains' | 'starts_with' |
'ends_with'"), and its Node SDK's types lack it. A `DENY` rule on calldata would deny the
registry's `register` too: Privy denies every call such a rule cannot decode.

## Decision

- **A venue marks such a contract.** `VenueContracts` gains `unapproved`: the names among its
  registry contracts whose own `approve` is never sent. The identity registry's declaration marks
  it. A name there is no spender.
- **The engine and the signer refuse it.** The engine puts every contract an enabled venue marks
  on the step's chain in the signer's `allowed.unapproved`, whether or not the intent's route uses
  the venue. Rule 2 refuses an approval whose `to` is one of them.
- **The ceiling does not change.** Privy has no operator that keeps one contract out of the
  approval rule while it names no token.

## Consequences

- An engine that works as built never sends an approval to the registry, and a signer that runs
  as built never signs one.
- What a machine whose keys are all stolen can still do: approve the agent's identity token to a
  declared spender, and through it move the token. The token holds no funds; its loss is the
  agent's on-chain identity, which the owner registers again. Decision 0149's promise does not
  change: no spender outside the venues' declarations, no send to an unsaved address.
- If Privy adds a `neq`, or a condition that excludes one `to`, a later decision may add it to the
  approval rule.

## Alternatives

- **List the tokens an approval may name.** Every token the wallet holds must stay sellable, so the
  list would be every token the agent ever buys. Lost.
- **A `DENY` rule for the registry.** It would deny `register` as well. Lost.
- **Leave identity out of v1.** The owner made it opt-in, not absent; the residual risk is the token
  alone.
