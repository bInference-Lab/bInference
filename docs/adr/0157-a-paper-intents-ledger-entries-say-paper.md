# 0157. A paper intent's ledger entries say paper

Status: Accepted

Accepted by the owner on 2026-10-11.

## Context

Every card, receipt and console row of a paper trade carries a Paper label
([ARCHITECTURE.md section 10](../ARCHITECTURE.md#section-10)). The console's ledger shows
`ledger/list` and the `ledger/appended` pushes. An intent's entry records its state and its cause
([spec 6, section 8](../specs/intent-states.md#section-8)), but not whether the intent is paper,
so a row of `proposed` or `confirmed` cannot tell a paper trade from a live one. The agent's mode
today says nothing of an entry written before the agent went live.

## Decision

- Each ledger entry of a paper intent carries `paper: true` in its data, from `proposed` on.
  A live intent's entries carry no `paper` field.
- The field is part of the entry's hashed data, as the cause is. Entries written before this
  change keep their data and their hashes.

## Consequences

- The console labels each row from the row alone, with no read of the intent behind it.
- The CSV export and any later reader see paper entries the same way.
- Entries from before the change show no label; the console reads a missing field as not paper.

## Alternatives

- **The console reads each row's intent with `intent/get`.** One call per intent on every page,
  for a fact the engine knows when it writes the entry.
- **Label rows by the agent's current mode.** Wrong for every entry written before the agent went
  live or back to paper.
