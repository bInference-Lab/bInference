# 0436. A lost lease stops the run where it stands and writes nothing after it

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

On bInference Cloud a worker holds an install through its lease rows, and every store write checks
them in its own transaction ([decision 0418](0418-an-install-keeps-a-lease-row-of-its-own-beside-its-agents-rows.md)):
once another worker took the install, a write throws `store.lease_lost` and changes nothing, and a
store host bound to another install's lease throws `store.lease_mismatch`. The signer service reads
the lease too and answers `lease_lost`, which the `privy-service` adapter throws as
`store.lease_lost` ([decision 0425](0425-the-signer-service-answers-each-request-once-and-keeps-an-audit-line.md)).

The engine's money code catches throws in several places and turns each into an outcome it
stores, counts or tries again:

- the executor ends a step that custody failed to sign as `sign_fault`, and a step whose nonce it
  could not take as `unprepared`, which waits a block and asks again for a first step and ends the
  intent with `step_unsent` for a later one
  ([decision 0109](0109-an-intent-whose-next-step-was-never-signed-ends.md)); a rescue tries a step
  it could not sign again a block later;
- an order's fill that throws is a skip, `fill_failed`, its intent cancelled; a webhook rule's fill
  is the same, and an alert entry that throws three runs ends `fill_failed`
  ([decision 0338](0338-a-webhook-rule-fills-through-the-money-path-s-fill-step-keyed-on-its-alert-s-row.md));
- a token launch whose upload began ends `upload_lost` with the owner's notice
  ([decision 0237](0237-a-token-launch-cut-short-after-its-upload-ends-with-a-notice.md)), and its
  first pin follow that throws answers the launch as it stood;
- the pin follow and the bridge follower log a launch or a bridge that threw and go on to the next;
- a risk source whose report the cache could not keep counts as down, so the trade is refused.

After a lost lease each of those is wrong. The intent did not fail: this engine stopped owning it.
Its end, its skip or its count is refused by the fence anyway, logged as a fault, and on any store
that does not check a lease it would land and end an intent the next holder must still recover.
Where the lease was lost after the signer service signed, the end would also be decided by an
engine that holds no lease to decide it.

## Decision

- **A lost lease is no fault of a step, a fill or an intent.** `store.lease_lost` and
  `store.lease_mismatch` say this engine no longer holds its install. Each catch of the money code
  that turns a throw into a stored end, a skip, a count, another try or an answer as if nothing
  happened lets these two codes through untouched, and only these: the executor's signature and its
  nonce write, the order fills, the webhook rule fills and their entries' failure counts, a
  launch's upload and first pin follow, the pin follow's and the bridge follower's passes, and the
  risk step's source answers. Every other fault keeps its outcome.
- **The run stops where it stands.** Nothing is signed, stored, sent, ended or told after the
  throw, and nothing asks again. The executor logs `executor.lease_lost` at `warn`, never
  `executor.failed`; a timer's pass rejects with the code, which its own failure line logs.
- **The next holder takes each intent from its stored state.** The intent stays where its last
  stored write left it: `confirmed` before the queue's move, `executing` after it, `finalized`
  before its reconciliation. The worker that takes the install next runs the engine's start: the
  recovery of spec 6, section 7, which reconciles each stored step by hash and nonce (decisions
  [0108](0108-native-coin-a-trade-received-is-read-from-the-balance.md) and
  [0109](0109-an-intent-whose-next-step-was-never-signed-ends.md)) and ends as never signed a step
  with no stored transaction, the confirmed intents' take, and the start's repairs of order fills,
  rule fills and launches. Nothing new is needed for that.
- **A signature given before the loss never leaves.** The store of the signed step is a write the
  fence refuses, so it is never sent; the next holder finds no stored transaction for the step and
  ends it as never signed, which is true.
- **Stopping the install's engine is the worker's.** It learns of the loss at its own store host and
  from its renewal, and stops the engine and runtime; the engine needs no hook for it.
- **Self-hosted changes nothing.** Its store has no lease and its signer process throws neither
  code.
- A catch that writes nothing for one item and throws a fault once the others settled, such as the
  DCA and copy order runs, stays as it is: each other item meets the fence at its own first write.

## Consequences

- A worker that lost its install leaves no false end, skip or count, and no alert or launch ends
  for it.
- Its log shows `executor.lease_lost` for each run it stopped, not a fault.
- A new catch in the money code calls `throwIfLeaseLost` first; review checks it, as no lint rule
  can tell a catch that writes from one that does not.
- A launch from chat whose Start a lost lease cut short still answers the press as failed; the
  next holder's pin follow repairs the launch itself.

## Alternatives

- Leave the fence to refuse each end, as today: every end is still tried and logged as a fault, a
  rescue tries its step three times, a first step's nonce is asked for each block until its
  authorization lapses, and a store without the check writes the end.
- Stop every work of the executor at the first lost lease: the engine would decide the install's
  stop, which the worker owns, and the other works meet the fence at their next write anyway.
- A port the engine calls on a lost lease: one more hook with no caller, while the worker sees each
  loss at its own store host.
