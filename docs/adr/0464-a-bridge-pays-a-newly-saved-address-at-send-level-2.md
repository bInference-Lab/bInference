# 0464. A bridge pays a newly saved address at send level 2

Status: Accepted

Accepted by the lead on 2026-11-28, on the owner's ruling of the same day: "remove the 24h address
wait for bridges too".

Changes [keys spec, section 4](../specs/keys-and-backups.md) on send level 2.

## Context

At send level 2, an address the owner saves is paid only 24 hours after it was saved. A bridge is a
cross-chain send (decision 0067), so it waits too. An owner who saves a destination address and asks
for a bridge right away is refused with `send_level` for a day.

A destination address is saved only with the owner key, which writes it into the wallets' bridge
rules. A stolen engine key or CLI token can save none, so the day's wait guards against nothing
those can do.

## Decision

At send level 2, a bridge pays a saved address at once. A send on the wallet's own chain still waits
24 hours for a newly saved address. Level 3 still allows no send and no bridge.

## Consequences

- An owner bridges to an address the moment it is saved.
- Someone who holds the owner key can save an address and bridge to it the same minute, with no day
  for the owner to notice. The owner key already lets them do more than that.
- The saved address's message says a bridge may pay it now.

## Alternatives

- Keep the wait for bridges: refused by the owner.
- Drop the level 2 wait for sends too: not asked for; a send on the wallet's chain keeps it.
