# 0444. A proposal a stop left before its card ends at the next start

Status: Accepted

Accepted by the tech lead on 2026-11-14.

## Context

A proposal runs from `proposed` through `checked`, `quoted`, `assessed` and `simulated` to its card
or, in auto mode, to `confirmed`, in the call that proposed it. Nothing is signed on the way. A
stop of the engine in that run, a crash, a kill or a lost lease
([decision 0436](0436-a-lost-lease-stops-the-run-where-it-stands-and-writes-nothing-after-it.md)),
leaves the intent where it stood, and the call that proposed it gets no answer.

[Spec 6, section 7](../specs/intent-states.md#section-7) says what the next start does with signed
steps, with `executing` and `confirmed` intents, and with an auto order's fill before its
confirmation ([decision 0210](0210-a-live-order-fill-signs-under-its-order-s-grant-and-counts-once-it-settles.md)).
A webhook rule's fill gets the same at the start
([decision 0338](0338-a-webhook-rule-fills-through-the-money-path-s-fill-step-keyed-on-its-alert-s-row.md)),
and a token launch is followed past a stop by its pin check
([decision 0237](0237-a-token-launch-cut-short-after-its-upload-ends-with-a-notice.md)).
Every other intent stays in its state for good: a crash test cut a proposal while its route
simulated and found it still `checked` after the restart. Nothing moves it again, and several
rules that let one of a kind run at a time read it as running:

- **A rescue.** While a rescue has not ended, `safety/rescue` answers that one
  ([decision 0125](0125-one-rescue-runs-at-a-time.md)). A rescue stuck before its card answers every
  later call, and no card ever opens: the owner's way out is closed.
- **An unfreeze.** While an unfreeze of the same scope has not ended, `safety/unfreeze` answers
  that one ([decision 0128](0128-an-unfreeze-waits-for-the-owner-s-tap-on-its-card.md)). A stuck one
  keeps the agent frozen, as no card opens.
- **A token launch.** While a live launch of the agent has not been signed or ended, a new one is
  `intent.launch_waiting`
  ([decision 0240](0240-one-token-launch-of-an-agent-runs-at-a-time.md)). The pin check follows a
  launch from `checked` on, so only one left in `proposed` stays.
- **An identity registration.** While a live registration of the agent has not ended, a new one
  is `intent.identity_pending`
  ([decision 0335](0335-an-identity-registers-once-from-the-owner-s-surfaces-and-is-stored-once-read-back.md)).
- **An auto order's or a webhook rule's card.** The order or rule waits for its card, which never
  comes. It counts toward the open orders of the agent's quota
  ([decision 0431](0431-quotas-come-from-one-port-and-are-counted-from-the-install-s-stores.md)) and the
  agent's 20 webhook rules, and the order list shows it waiting for good.

A stuck intent blocks no wallet's queue, which takes only `confirmed` intents, and no rolling cap,
which counts only confirmations. The proposal quota counts intents by when they were stored, in any
state, so a stuck one leaves it within its minute as any other does.

## Decision

- **Every proposal a stop left before its card ends at the start.** At each start of the engine,
  among the repairs of what a stop left, after the breaker's first look and before the queue takes
  any `confirmed` intent an earlier run left or any order or timer runs, every intent in
  `proposed`, `checked`, `quoted`, `assessed` or `simulated` moves to `cancelled`, live and paper
  alike. Nothing of it was signed and no card of it was shown.
- **The move is the state machine's own.** It is the existing row from any state before
  `executing` to `cancelled`, on `cancel_requested` with the cause `engine_stopping`, which the
  intent's event records. The intent stores no reason code. The stored intents write it, one intent
  at a time, under the version each read; one another write moved first is left to it.
- **An order or a rule ends with its card.** Right after an auto order's or a webhook rule's card
  intent is cancelled, its order follows the card as a denied or expired card's does today: the
  order is `cancelled` and the rule `deleted`, so neither counts toward the agent's open orders or
  rules, and no fill can run for it.
- **Two kinds keep their own repair.** An intent the engine proposed is an order's or a rule's fill,
  which its own repair ends with its order's or rule's row (decisions 0210 and 0338). A token
  launch past `proposed` is the pin check's, which carries a launch across a stop and ends it with
  `notice.launchStopped` when it cannot go on (decision 0237). The new step leaves both alone; a
  launch in `proposed` uploaded nothing and ends with the others.
- **No notice.** No card was shown, so none closes and the owner hears nothing. The move pushes
  `intent/changed` and appends its ledger entry, as every move to `cancelled` does (spec 6, section
  8). The proposer reads the end in the intent list
  ([decision 0437](0437-an-idempotency-key-is-marked-started-in-the-store-before-its-write-runs.md)):
  a call it sends again plans afresh, as a rescue or an unfreeze does on the owner's next call.
- **Only at the start.** A running engine moves nothing new: a proposal it runs goes on to its card
  as today. On bInference Cloud, the worker that takes the install's lease runs the start, so the
  next holder ends what the last one left, and a lost lease during this step stops it where it
  stands (decision 0436).

## Consequences

- No proposal outlasts a restart in a state that nothing moves, so every one-at-a-time rule above
  frees itself at the next start. A rescue or an unfreeze cut short opens its card on the owner's
  next call.
- An order or a webhook rule whose card intent ends this way ends in the same step. A stop between
  the two moves leaves the order or rule to the order timer's next run, which ends it as one whose
  card was cancelled.
- The engine gains a startup step, `endUnfinishedProposals`, which the composition root calls
  among the repairs of what a stop left. It reads every page of intents in those five states with
  the intent store's `list`, which each adapter serves; a contract case holds that read to every
  state before a card, in both modes.
- Spec 6 section 7 and ARCHITECTURE section 24 name the step. No transition row, reason code,
  notice or migration is added.

## Alternatives

- **Resume each proposal from its state.** The money path would run again from `checked` or
  `simulated` on a quote, a policy read and a simulation from before the stop, and open a card, or
  in auto mode confirm it, for a call whose caller has gone. Re-running from the start would give a
  card nobody waits for and an auto trade the owner did not see asked. Rejected.
- **A reason code, such as `engine_stopped`.** It would tell a proposer why the intent was
  cancelled, but adds words in every surface for an end no person saw, and every other cancel
  but a signer service refusal carries none. The event's cause already records it. Rejected.
- **`failed_check` or `expired`.** `failed_check` means a quote, a build, a decode or a simulation
  failed, and the owner is told for fills; `expired` means a card ran out. Neither happened.
  Rejected.
- **`notice.notSigned` or a notice of its own.** The owner saw no card and asked for nothing that
  failed, so a notice would announce an end of something the owner never saw; for a rescue or an
  unfreeze, the owner's call already got no answer. Rejected.
- **Teach each one-at-a-time rule to skip an old intent.** Each rule would need its own age, and
  the stuck intent would still sit in its state, shown as running by the intent list. Rejected.
