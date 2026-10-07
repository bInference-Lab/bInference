# @binference/custody-privy

The `privy-owner` custody adapter: key quorums, the ceiling, agent wallets and signing calls
through Privy's API (spec 5, decision 0085).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is money code: a change here runs the `review-money-path` skill. No `Number` or `parseFloat`
  on an amount; wei travels as `bigint` and as hex quantities on the wire.
- The ceiling is Privy's policy language. A change to `src/ceiling/` changes what every wallet may
  sign: the known-answer test and the property test against the fake's policy engine change with
  it, and the change needs the owner key on every existing wallet.
- `src/testing/` holds the Privy fake and the fixtures; only it imports viem. The fake enforces
  Privy's request shapes, authorization signatures and policy semantics, and refuses what it does
  not model, never ignoring it.
