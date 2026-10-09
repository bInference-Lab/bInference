# 0115. A stuck step every relay refuses is dropped and ends

Status: Accepted

## Context

[Spec 6, section 6](../specs/intent-states.md#section-6) names the transaction state `dropped`,
gone from every relay with its nonce still free, but said neither when the engine records it nor
how its intent ends. A stuck step that no rule could move (a replacement above the network fee
cap, one custody refused, a cancel that would fail) stayed `executing`, and its transaction kept
the wallet's nonce, so every later transaction of the wallet waited behind it until a restart,
whose recovery found it stuck again. A relay that turns the bytes away with an answer such as
"underpriced" or "insufficient funds" holds none of them: one that holds them answers that it
knows them already. The stuck rules also read two points spec 6 left open: what "simulate again"
means, and what fee a replacement may pay.

## Decision

A stuck step is dropped once every relay has turned its bytes away for 60 blocks and the chain
shows its nonce still free:

- Every send of the step's transaction in those blocks was refused by every relay with an answer
  that says it holds none of it: underpriced, insufficient funds, the relay's gas quota, bytes it
  cannot read, or another refusal. A nonce a block used, a rival it holds at the nonce, its rate
  limit, an answer outside its protocol, a timeout or no answer stop the count.
- No transaction the step replaced may still sit with a relay: none took it, or every relay
  turned away its last send.

The step's transaction is recorded `dropped`, which frees its nonce for the wallet's next step.
The intent ends `failed_onchain` with the new reason `stuck_dropped`, and the owner gets
`notice.stepDropped` ("The trade did not go through and nothing moved. The wallet is free
again.") or, once an earlier step landed, `notice.stepDroppedPartWay`.

60 blocks is three times the 20 after which a step counts as stuck, the span the executor already
waits for a head it cannot read. By then the stuck rules have run in full: the same bytes at 20
blocks, a replacement at 40, and 20 more blocks for the replacement. On BNB Smart Chain, at 0.45
seconds a block, it is about 27 seconds.

A step no rule can move waits handed over: it gets the same bytes again every 20 blocks, so the
relays' answers keep the count, and after 60 blocks without a drop it is handed over, still
`executing`, as before. Recovery, which never signs, applies the same rule; a step recorded
`dropped` before a stop ends the same way, unless a block holds one of its transactions after
all, which is then recorded and the intent goes on.

The stuck rules read spec 6 this way, as the owner accepted on 2026-10-09:

- "Simulate again" means preparing the step's draft again on the latest state: the chain's gas
  estimate runs the call there, and a call that fails now is no longer valid. The calldata fixes
  the minimum out and the deadline, so a call that still runs still pays at least the minimum out.
- No replacement, speed-up or cancel, is signed with a fee per gas above the network fee cap
  ([decision 0102](../DECISIONS.md#d0102)): no tap showed the owner that fee. The step is handed
  over instead.

## Consequences

- Spec 6 gains the `executing → failed_onchain` row on `step_dropped`, the reason `stuck_dropped`,
  a fourth stuck rule and the two readings; spec 4 gains both notices; `reason.stuck_dropped` and
  the notices ship in English and Chinese.
- The transaction store gains `recordDropped`; the executor's limit `droppedAfterBlocks` is 60.
- A property test drives stuck swaps through refusing relays and finds no dropped step that any
  block holds.
- A dropped transaction that lands after its intent ended shows as another transaction at the
  wallet's next nonce: that step ends with `nonce_taken` and the alarm notice, and the owner
  checks the wallet.

## Alternatives

- **Never drop.** The wallet stays blocked behind the stuck nonce. Rejected.
- **Drop at the first refused send.** A relay may take the bytes on the next send. Rejected.
- **Drop after 600 blocks, the finality wait.** Four and a half minutes of a blocked wallet for a
  step the relays have long turned away. Rejected.
- **Count a timeout as a refusal.** A relay that does not answer may hold the bytes. Rejected.
