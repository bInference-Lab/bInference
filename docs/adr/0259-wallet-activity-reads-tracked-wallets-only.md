# 0259. Wallet activity reads tracked wallets only

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Spec 1](../specs/protocol.md) section 7.3 had `wallet/activity` read one of the agent's own
wallets from its executions, or a wallet the agent tracks from what the leader watcher recorded.
[Decision 0251](0251-the-writes-that-start-and-end-a-wallet-s-tracking-keep-tracked-wallets.md)
repeats it in its consequences, and [spec 3](../specs/database.md) section 2.6 says the same. The
engine reads tracked wallets only: it answers the agent's own wallets with `wallet.not_found`.
The agent already reads its own wallets elsewhere: `portfolio` answers balances, positions and
P&L, and `tx_status` answers each of its intents with its transactions and fills.

## Decision

- **Tracked wallets only.** `wallet/activity` reads a wallet the agent tracks: the leader of one
  of its copy orders, or the account of one of its wallet alerts. Every other account, the
  agent's own wallets among them, fails `wallet.not_found`.
- **The agent tool says where to look.** `wallet_activity` reads the refusal to the model as words
  that send it to `portfolio` for the agent's own holdings and P&L, and to `tx_status` for one of
  its intents ([decision 0257](0257-the-agent-s-market-reads-mark-the-turn-when-they-answer-data.md)).
- This amends decision 0251's consequence that `wallet/activity` reads the agent's own wallets
  from their executions.

## Consequences

- Spec 1's `wallet/activity` row and paragraph, spec 3's `wallet_activity` table, spec 8's tool
  list and ARCHITECTURE.md's tool table say tracked wallets only and name the refusal.
- Every result of `wallet/activity` is another wallet's doing, so `wallet_activity` marks each
  turn that reads trades.
- The engine keeps one source of a wallet's trades, the leader watcher's records; nothing turns
  executions into activity items.

## Alternatives

- **Read the agent's own wallets from `executions`,** as spec 1 said. A second shape of the same
  facts `portfolio` and `tx_status` already give, with its own paging and tests. Rejected by the
  owner.
