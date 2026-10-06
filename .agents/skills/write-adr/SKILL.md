---
name: write-adr
description: Writes an architecture decision record. Use when a change rests on a load-bearing decision, or when the specs and rules are silent and a choice must be made.
---

# Write an ADR

No random choices. When the architecture, the specs and `docs/ENGINEERING.md` are silent, write a
short ADR and get the maintainers' yes before coding.

## 1. Number and file

- The next free number after the last one in `docs/DECISIONS.md`, four digits. Decisions 0001 to
  0097 are the log; records start at 0098: `docs/adr/0098-sign-in-the-wallet-queue.md`.
- The title says the decision, not the topic.

## 2. Write it

```md
# 0098. Sign in the wallet queue

Status: Proposed

## Context

What forces the decision: the problem, the constraints, what the specs and rules say.

## Decision

What we do, in plain sentences.

## Consequences

What gets easier, what gets harder, what must change elsewhere.

## Alternatives

Each option considered and why it lost.
```

Keep it short. State facts and numbers, not opinions. The four headings appear once each, in this
order.

## 3. Index

Add its row to the "Decision records" table of `docs/DECISIONS.md`, with the same status as the
file:

```md
| <a id="d0098"></a>0098 | Sign in the wallet queue | Proposed | [adr/0098-sign-in-the-wallet-queue.md](adr/0098-sign-in-the-wallet-queue.md) |
```

## 4. Decide

- A proposed ADR waits for the maintainers' yes. Coding starts after it.
- When it is accepted, set `Status: Accepted` in the file and in its row, then run
  `pnpm check:adr --write` to lock its text in `docs/decisions.lock.json`.
- Once accepted, its body never changes. A new decision is a new ADR that supersedes or amends the
  old one; the old one's status, in its file or its log row, becomes `Superseded by NNNN` or
  `Amended by NNNN`.
- `pnpm check:adr` checks the numbering, the headings, the index and the lock.

## 5. Report

Give the ADR's path and the question the maintainers must answer.
