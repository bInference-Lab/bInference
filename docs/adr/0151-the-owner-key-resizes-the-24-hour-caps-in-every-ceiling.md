# 0151. The owner key resizes the 24-hour caps in every ceiling

Status: Proposed

## Context

[Decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md) caps what venue calls can
lose in 24 hours with Privy aggregations that every wallet of the install shares: the native coin
sent, and the approvals of WBNB, USDT and USDC on BNB Smart Chain. Init sizes each at twice
`defaults.limits.rollingDayUsd`, at a floor of $100 for BNB and WBNB and $1 for each stablecoin.
Nothing changed them after init, and `ceiling/get` did not show them.

Privy's docs, read on 2026-10-11 ("Stateful policies", "Using stateful policies", the aggregations
API reference and "Update a policy", docs.privy.io):

- An aggregation can be made (`POST /v1/aggregations`), read and deleted
  (`DELETE /v1/aggregations/{id}`, the app secret alone). No page offers to change one.
- The most a sum may reach is not in the aggregation. A rule's `reference` condition compares the
  sum with its own value. A policy's rules change one at a time, each with a `PATCH` of
  `/v1/policies/{policy_id}/rules/{rule_id}` that the policy's owner signs.
- An app keeps at most 10 aggregations, and a deleted one makes every condition that names it
  false. Privy advises deleting the policy first.

## Decision

- **A resize changes the rules, not the aggregations.** `binference ceiling set` with
  `--day-cap-usd <dollars>` sizes every 24-hour cap at that many dollars at its floor price,
  rounded up, as init does. With the owner key it writes each call rule and approval rule over
  with the new value of its `reference` condition, through the same rule change as the venues and
  the per-transaction cap
  ([decision 0132](0132-a-ceiling-change-applies-to-every-wallet-of-the-agent.md)). The
  aggregations, their sums and their 24-hour window stay, so a resize makes none and Privy's limit
  of 10 does not move.
- **It reaches every wallet of the install.** The sums are the install's, so a resize writes the
  ceiling of every live wallet of every agent that names caps; each rule compares the same sum
  with the same size. It comes alone in `ceiling/set` (`changes.dayCapUsdMicros`, above 0); with
  another change it is `protocol.bad_args`. The change is journaled and announced as
  `notice.ceilingChange` with `dayCaps`.
- **The ceiling shows its caps.** `ceiling/get`, `ceiling/set` and `binference ceiling` show each
  cap: what it counts, its size in the asset's units and in dollars at the floor price, and its
  window. The approval rule names the token caps in the order the chain's data lists the tokens,
  as init made them, so each is matched to its token by place; a resize of a ceiling that names
  another count of token caps stops as a fault.
- **The custody suite cleans up.** The live suite deletes the aggregations it made once its
  checks end, so runs on the Privy test app never use up its 10.

## Consequences

- An owner who runs several agents raises the caps once, for all of them.
- A cap below twice the engine's rolling 24-hour cap makes Privy refuse a venue call before the
  engine does; binference does not refuse such a size.
- A window other than 24 hours would need new aggregations and a policy change on every wallet;
  no command offers it.
- The protocol spec, spec 5 section 4 and the CLI's messages in English and Chinese say so.

## Alternatives

- **Make new aggregations of the new size.** The size is not in an aggregation, and each new set
  takes 4 of Privy's 10 until the old one is deleted. Rejected.
- **Resize per agent.** Every ceiling compares the same sums: two sizes for one sum make the
  smaller one bind every agent. Rejected.
- **Set each cap in its own token.** Init and the floor rule size them from dollars; one dollar
  amount keeps the floors and the caps in step. Rejected for now.
