# 0124. A rescue leaves out a transfer its simulation refuses

Status: Accepted

## Context

Spec 6 moves an intent to `simulated` only when the simulation's balance changes match the
request, and to `failed_check` otherwise. A rescue's steps are independent transfers: one token
whose transfer reverts, or moves something besides itself, would fail the whole rescue and leave
every other token and the coin in a wallet the owner wants emptied. The owner decided on
2026-10-10.

## Decision

A rescue simulates each wallet's sends in order. A send passes when it succeeds, moves exactly its
amount of its own asset out of its wallet and nothing else, sets no allowance and lands some of the
asset at the rescue address. A send that fails these checks, or whose asset its chain family cannot
send, is left out of the plan before the card opens, and the rest go. A token that takes a tax on
transfers still goes, and the stored simulation shows what reached the rescue address. With
nothing left, no rescue is stored.

## Consequences

- The card counts only the tokens and wallets that will move.
- A token whose transfer is paused, or that runs code moving other assets, stays in its wallet.
- The rescue still reaches `simulated` as one intent.

## Alternatives

- **Fail the whole rescue.** One bad token would block the safety exit. Rejected.
- **Send every transfer unchecked.** A transfer could move other assets of the wallet. Rejected.
