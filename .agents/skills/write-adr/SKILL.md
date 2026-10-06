---
name: write-adr
description: Writes an architecture decision record. Use when a change rests on a load-bearing decision, or when the specs and rules are silent and a choice must be made.
---

# Write an ADR

No random choices. When the specs and `docs/ENGINEERING.md` are silent, write a short ADR and get
the owner's yes before coding.

## 1. Number and file

- The next free number, four digits: `docs/adr/0042-sign-in-the-wallet-queue.md`.
- The title says the decision, not the topic.

## 2. Write it

```md
# 0042. Sign in the wallet queue

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

Keep it short. State facts and numbers, not opinions.

## 3. Index

Add a line for it to `docs/DECISIONS.md`, with its number, title and status.

## 4. Decide

- A proposed ADR waits for the owner's yes. Coding starts after it.
- Once accepted, its body never changes. A new decision is a new ADR that supersedes the old
  one; the old one's status becomes `Superseded by NNNN`.

## 5. Report

Give the ADR's path and the question the owner must answer.
