# 0100. A rescue in paper mode moves real funds

Status: Accepted

## Context

[Decision 0019](../DECISIONS.md#d0019) starts every agent in paper mode, where nothing is broadcast.
[Decision 0044](../DECISIONS.md#d0044) gives the owner `/rescue`, which sends every token and the BNB
of every agent wallet to the rescue address after one tap, at any send level and while frozen. An
agent in paper mode still has a real wallet: the owner may fund it before going live, or leave funds
in it after switching back to paper. The policy step refused a rescue in paper mode with
`paper_only`, since a paper intent fills at its quote and moves nothing. So the safety exit did not
work for a paper agent with real funds in its wallet.

## Decision

`/rescue` always moves the real funds to the rescue address after the owner's tap, in paper mode as
well as live. Paper mode fakes trades, never the rescue.

A rescue is stored as a live intent whatever the agent's mode. The policy never refuses it with
`paper_only`, the paper fill never takes it, and the wallet queue takes a confirmed rescue while the
agent is in paper mode. Its card is marked Live, like any live intent.

## Consequences

- Spec 6 says so in its transition table, its `paper_only` row, its rescue section and its
  invariants.
- The state machine stores a rescue with `isPaper: false`, and the queue guard skips the paper-mode
  check for a rescue. A property test checks that a rescue proposed in paper mode is live, passes
  the policy, never fills on paper and is taken by the queue.
- Every other intent of a paper agent still fills at its quote, and nothing else is broadcast.
- Decision 0019 keeps its text, with the status Amended by 0100.

## Alternatives

- **Refuse a rescue in paper mode,** as before. The owner would first go live, a loosening that
  needs the CLI, the console or the Mini App, at the moment they want the funds out. Rejected.
- **Fill a rescue on paper.** It would report a rescue and move nothing. Rejected.
