# 0123. One rescue intent spans every wallet, each sending from its own queue

Status: Accepted

## Context

[Spec 6, section 5](../specs/intent-states.md#section-5) makes a rescue one intent with one card
and one step per token per agent wallet. Every intent row names one agent and one wallet
([spec 3, section 2.3](../specs/database.md#section-2-3)), and each wallet's nonces belong to its
own queue ([spec 6, section 9](../specs/intent-states.md#section-9)). The spec did not say how one
intent names many wallets, which wallet signs each step, or how the steps meet the queues. The
owner decided on 2026-10-10.

## Decision

- The rescue intent is stored under the first wallet, oldest first, that moves something and whose
  agent is active, and under that agent.
- Its quote is a rescue quote in the intent's `quote` column: the rescue address, each move in the
  plan's order with the wallet that signs it and its amount, their value and the time. The card's
  terms hash covers the quote, so a confirmation binds every move and its wallet.
- The executor takes the rescue on the first wallet's queue once the queue check passes, then runs
  each wallet's steps in order on that wallet's own queue, the wallets one after another. Each
  step is a send its move's wallet signs, with the rescue address as the only recipient the
  signer's hard rules allow.
- A step stuck at its nonce ends its wallet's part; the other wallets still send.

## Consequences

- `IntentView.agent` and `wallet` name the wallet the rescue is stored under; the rescue's quote
  lists every wallet.
- A wallet's queue is held only while that wallet's steps run, so its next intent waits for those
  alone.
- One slow wallet delays the wallets after it.

## Alternatives

- **One rescue intent per wallet.** Many cards for one tap, against spec 6. Rejected.
- **All wallets in parallel.** Faster, but the order of a rescue's sends would depend on timing.
  Rejected for v1.
