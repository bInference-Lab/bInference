# 0426. A Cloud user's 24-hour sums count a send but never refuse one

Status: Accepted

Accepted by the tech lead on 2026-11-12. Amends
[decision 0422](0422-each-cloud-user-s-24-hour-sums-are-reserved-before-the-key-signs.md).

## Context

[Decision 0422](0422-each-cloud-user-s-24-hour-sums-are-reserved-before-the-key-signs.md) has the
signer service keep each user's 24-hour sums as Privy's caps keep them, and refuse with
`over_sums` when a transaction would pass a cap. Privy's caps do not refuse every transaction
they count: a venue call holds only while the native coin sent in the last 24 hours stays within
the chain's cap, and an approval only while its token's approvals stay within theirs, but the send
rules, to the rescue address, to a saved address, and the cancel to the wallet itself, carry no cap
at all. A send itself is never capped (spec 5, section 4). Refused at the cap, a rescue of a wallet
holding more than the day's cap would never leave on Cloud, while self-hosted lets it go.

## Decision

- The sums count what decision 0422 says they count: the native value of every transaction the
  service signs, and the amount of every approval of a capped token. A cancel counts nothing, and
  a token send adds to no sum, since it sends no native value and approves nothing.
- `over_sums` refuses only what Privy's caps refuse: a call whose native value would pass the
  chain's native sum, and an approval of a capped token whose amount would pass that token's sum.
- A send to the rescue address or to a saved address, of the coin or of a token, and a cancel are
  never refused, so a rescue always leaves. A coin send still adds its value to the native sum.

## Consequences

- A Cloud user's rescue and saved-address sends behave as a self-hosted owner's do.
- A send can fill a sum, so a later call or approval of the day meets `over_sums` sooner.

## Alternatives

- Refuse sends at the cap too: a rescue could stop at the cap, which no self-hosted owner meets.
- Leave sends out of the sums: a later call could then move more than a self-hosted install's caps
  allow in the same day.
