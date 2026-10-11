# 0149. The ceiling bounds what stolen keys can lose

Status: Amended by 0151

## Context

[Decision 0091](../DECISIONS.md#d0091) says a hacked machine "can trade inside the ceiling but
cannot pay an attacker". That does not hold:

- The ceiling let a call reach a listed contract with any calldata, at most 1 BNB a call and no
  limit on the number of calls, and let `approve` name any listed contract with any amount.
- Privy's policies read calldata by `function_name` and `function_name.param_name`, a function's
  top-level inputs only ("Policies" and "Ethereum examples", docs.privy.io). KyberSwap's
  MetaAggregationRouterV2 takes its receiver inside `swap(SwapExecutionParams)`, and OKX's DEX
  router lets the caller choose `path.assetTo` in `dagSwapTo` and `dagSwapByOrderId`.
- A router swap with a minimum return of 0 into a pool its caller owns pays that caller, whatever
  the receiver field says. No policy can stop it.

Privy's stateful policies, read on 2026-10-11 ("Stateful policies", "Using stateful policies" and
the aggregations API reference, docs.privy.io):

- An aggregation sums one field (`sum` only) over a rolling window of 1 to 72 hours. A rule's
  `reference` condition compares that sum, plus what the request adds, with a value.
- An app keeps at most 10. The sum is recorded after Privy signs, so parallel requests can pass
  together: Privy calls them disaster limits. A value Privy cannot read from a request counts 0.
  A deleted aggregation makes every condition that names it false.
- Aggregations belong to the app, and each sums the requests of every wallet whose policies name
  it. `group_by` reads transaction or calldata fields only, and an aggregation's conditions take no
  template variable, so no documented field splits a sum per wallet.
- Privy's Node SDK, 0.35.0, the latest release, has no aggregation call. Privy's recipe makes one
  with `POST /v1/aggregations` and the app's Basic auth.

The owner chose on 2026-10-11 to make the promise honest, narrow the policy, and cap it.

## Decision

- **The promise.** A machine whose keys are stolen:
  - cannot send BNB or a token to an address the owner did not save;
  - cannot call a contract or a function no enabled venue declares, nor approve a spender no
    enabled venue declares;
  - can lose through venue calls at most the 24-hour caps below;
  - can trade at a bad price inside those caps, and can sell any token the caps do not name at any
    price.

  This amends decision 0091: sends stay limited to the rescue address and the saved addresses,
  and the sentence "cannot pay an attacker" no longer holds. `binference check` says the promise.

- **Each venue declares what it calls.** A venue's declaration names, on each chain, the functions
  its trades call, each with its JSON ABI entry and the inputs that must be the wallet itself, and
  the contracts an approval may name. KyberSwap declares its router's `swap` and the router as
  spender. OKX declares `dagSwapByOrderId`, `dagSwapTo` with `receiver` pinned, and TokenApprove as
  spender. Both approve the exact input
  ([decision 0105](0105-okx-is-the-second-quote-through-a-thin-client.md)).
- **One rule per function.** The ceiling allows, per chain and function name, a call to the
  contracts that declare it, matched by `function_name` with its ABI, with at most the
  per-transaction cap in native coin and each pinned input equal to `{{wallet.address}}` (a whole
  value only). `approve` names only a declared spender. No call rule names an executor, a token or
  a Permit2. `binference ceiling set` adds and takes out these rules with the owner key.
- **24-hour caps.** Each chain has one aggregation of the native `value` of every transaction on
  the chain, and one of the `approve.amount` of each capped token: WBNB, USDT and USDC on BNB Smart
  Chain, 4 of Privy's 10. Every call rule compares the native sum with its cap, and the approval
  rule compares each token's sum with its own. The caps are twice `defaults.limits.rollingDayUsd`,
  since a speed-up or a reverted transaction counts again, at a floor of $100 for BNB and WBNB and
  $1 for each stablecoin: 10 BNB, 10 WBNB, 1,000 USDT and 1,000 USDC with the default $500 day.
- **One set per install.** The Privy app is the install's ([decision 0087](../DECISIONS.md#d0087)),
  so the caps bound every wallet of every agent of the install together. Init makes the
  aggregations once, owned by the owner key's quorum; every later ceiling names the same ones.
  `custody-privy` makes them with `POST /v1/aggregations` through the `Http` port, its one request
  written by hand.
- **A venue in a ceiling.** A ceiling no longer names every registry contract of a venue, only the
  ones its trades call or approve. The engine counts a venue inside a ceiling when the ceiling
  names one of its registry contracts. This amends
  [decision 0111](0111-a-looser-limit-waits-24-hours-a-stricter-one-applies-at-once.md), whose
  `limit.over_ceiling` read "names some registry contract of the venue nowhere".

Accepted by the owner on 2026-10-11.

## Consequences

- Sends to the rescue address and to saved addresses count toward the native cap, as the sum
  reads every transaction on the chain. After a large send, venue calls wait for the window to
  roll; the send itself, and a rescue, are never capped.
- Several agents share the caps. An owner who runs more than one raises them; until a command does
  that with the owner key, the caps stay as init made them.
- A request Privy signs counts even when it never lands. Parallel requests can pass the cap
  together, each at most the per-transaction cap.
- Privy's delete of an aggregation takes the app secret alone. Whoever holds it can make every
  venue call and approval fail until the owner makes the caps again; nothing more.
- The approval rule compares each capped token's sum on every approval. Privy's docs say a request
  its conditions leave out adds nothing, so an approval of another token only reads the sums. If
  Privy added it anyway, such approvals would be refused, never allowed. A check on the Privy test
  app can confirm which.
- A ceiling made before this decision does not read back as one `buildCeiling` builds, so
  `binference init --attach` on an empty folder adopts none of its wallets. No release has made
  one.
- Spec 5 section 4, the README, `SECURITY.md` and ARCHITECTURE section 8 say the new promise.
- `ceiling/get` does not show the caps yet.

## Alternatives

- **Pin every receiver.** Privy reads top-level inputs only, and a swap into the caller's own pool
  pays the caller whatever the receiver says. Not possible.
- **Keep the promise as written.** It is false. Rejected by the owner.
- **Aggregations per wallet.** Privy keeps 10 per app: two wallets would use them up. Rejected.
- **Count only calls to venue contracts in the native sum.** An aggregation cannot change after it
  is made, so a venue added later would go uncounted. Rejected.
- **Size BNB caps at the price of the day.** The ceiling is built before any price is read, and
  the price moves after. Rejected for a floor that only makes a cap tighter in dollars.
- **A counter on the machine.** A stolen machine controls it. Rejected.
