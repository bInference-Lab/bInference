# 0108. Native coin a trade received is read from the balance

Status: Accepted

## Context

Reconciliation ([spec 6](../specs/intent-states.md), `finalized → reconciled`) turns what each
step of a live intent moved into the trade. On an EVM chain the receipt's logs show every token
transfer, and the transaction's own value shows the native coin it sent. Native coin an inner call
sends leaves no log: on a sale of a token for BNB, the router unwraps WBNB and pays the BNB out
inside the call. Reading inner calls needs `debug_traceTransaction`, which BNB Chain's public
nodes do not serve; a paid provider does. Without it, every sale for BNB would record nothing
received and raise the 1% alarm. Full nodes keep the state of recent blocks, and reconciliation
runs a few blocks after a step is included.

## Decision

The native coin a wallet received in a block is its balance after the block less its balance
before, plus what the wallet's own transactions in that block paid: their fees, and the values of
those that ran. Reconciliation adds it once for each block that holds a step of the intent.

When no node still holds the state before the block, the owner's tracing RPC answers instead, if
one is configured: the `callTracer` frames of the wallet's transactions that ran say what their
inner calls paid it. Without one, the owner gets an alarm notice.

Accepted by the owner on 2026-10-09.

## Consequences

- The receipt reader port reads the native coin a wallet received in a block, or answers that the
  state is gone. The RPC failover tells a node that pruned the state from one that is down, and
  fails a read every node pruned with `chain.state_missing`.
- Config gains `chains.rpc.<chain>.traceUrl`, the owner's tracing RPC, with its config migration.
- Spec 4 gains `notice.fillUnknown`. While neither a node nor a tracing RPC can say what the trade
  received, the intent stays `finalized` and nothing is recorded for it; after a restart with a
  tracing RPC, recovery reconciles it.
- Native coin another account sends the wallet in the same block counts as received. The
  comparison with the simulation raises the 1% alarm when it changes the result.
- A fork test sells a token for BNB and reconciles the BNB received against the balance change on
  the chain.

## Alternatives

- **Trace every transaction.** Every owner would need a paid node, and the default setup is
  keyless ([rule 16](../ARCHITECTURE.md#rule-16)). Rejected.
- **Read WBNB's `Withdrawal` log.** It names the router that unwrapped, not the account it paid.
  Rejected.
- **Record nothing received, with the alarm.** The ledger would hold a loss that never happened.
  Rejected.
- **Take the amount from the simulation.** The ledger would hold a guess. Rejected.
