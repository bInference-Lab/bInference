# 0441. While the breaker holds, only a rescue runs and an unfreeze waits for the lift

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

While the breaker is pulled, the signer service signs only a rescue's steps, with that rescue's
speed-ups and cancel
([decision 0424](0424-the-cloud-breaker-is-one-row-only-binference-s-owner-moves-read-on-every-signature.md)).
An owner's freeze is looser in two places: it lets an approval revoke through, with its card and
tap ([decision 0312](0312-a-frozen-agent-may-still-revoke-an-approval-with-the-owner-s-tap.md)),
and a live intent already executing signs its later steps under it (spec 6, section 3). Under the
breaker the service refuses both, and a refused step ends as one never signed
([decision 0427](0427-the-engine-ends-an-intent-the-signer-service-answers-over-sums-or-locked.md)).
An owner's unfreeze ends only the owner's own freeze
([decision 0440](0440-the-breaker-holds-an-install-by-a-mark-of-its-own-apart-from-the-owner-s-freeze.md)),
so while the breaker holds it would change nothing the owner can see.

Every refusal today names the owner's freeze: `agent.frozen` and the reason `frozen`, whose words
tell the owner to unfreeze. The owner needs to know that the breaker holds, that their funds stay
reachable through a rescue, and when it lifts. Protocol v1 takes additions only: a new code, a new
reason in an open list and a new optional field are additions; a new value in a closed list of a
view is not.

## Decision

- **A freeze's rules on every agent.** At the pull, the engine cancels every unsigned intent but a
  rescue, the cards that wait among them, an unfreeze's too; pauses each active auto order and
  cancels each one awaiting its card; and stops each running turn once, as a freeze does
  (`inbox/stop` with `freeze`). A sent transaction is watched to its block or dropped by its own
  rules: a speed-up or a cancel the service refuses hands the step over, which sends its own bytes
  again and never ends it (spec 6, section 6).
- **Only a rescue starts.** The policy's new first rule, `breaker`, refuses every intent but a
  rescue while the breaker holds the install, an approval revoke and a paper intent among them,
  since the service would refuse the revoke's step and a freeze's rules hold paper too. A rescue
  keeps its own rules: one that waits goes on, and the owner may ask for a new one with
  `safety/rescue`, one at a time ([decision 0125](0125-one-rescue-runs-at-a-time.md)); it pays only
  the rescue address in effect, which the service checks again.
- **Refusals name the breaker.** Where the breaker holds the install, every operation that refuses
  a frozen agent with `agent.frozen` answers `safety.breaker` instead, whether or not the owner
  froze it too, since an unfreeze would not help; not retryable, as no one can tell when it lifts.
  A webhook rule's alert skips with `breaker`. A view's closed list, such as a schedule run's skip
  or a goal's pause, keeps `frozen`. The runtime treats `safety.breaker` as it treats
  `agent.frozen`.
- **An unfreeze waits for the lift.** `safety/unfreeze` answers `safety.breaker` while the breaker
  holds, opens no card and stores nothing. A Confirm of an unfreeze card reads the breaker's mark
  again and is refused the same way: the card stays open, nothing is written and no
  `notice.unfrozen` goes out. `config/propose` answers `safety.breaker` too, as every proposal but
  a rescue is refused. The owner's freeze stays open to them, and holds after the lift
  (decision 0440).
- **A store's own refusal names it too.** An order or a rule the store refuses for a frozen agent,
  in a race with the pull, answers `safety.breaker` while the breaker holds.
- **What stays.** Every read; the owner's messages start turns while wake-ups do not, as under a
  freeze; alerts notify; the watchers, the reconciliation of sent transactions, bridges in transit
  and the daily summary go on; the webhook listener stores each alert; and every brake: a freeze, a
  cancel, a switch to paper, a stricter limit, a delete and a disable.
- **The owner is told** once per pull and once per lift, on every surface, in English and Chinese:
  `notice.breakerPulled`, and `notice.breakerLifted`, which names the agents the owner's own freeze
  still holds as a list, `lists` of a notice part, which each surface joins as the owner's language
  lists words. Neither can be muted.
- **Every view that says an agent is frozen says so,** and names the breaker: Telegram's `/status`
  shows each agent frozen and a line for the breaker; the deposit warning, `cmd.wallet.brakedFunds`
  on Telegram, the console and the terminal, says the agent is held and the funds stay, and never
  says to unfreeze; `chat/deposit` gains `breaker?: true`; the agent's live facts and
  `agent_status` name the breaker.
- **`safety/status`** gains `breaker?: { pulledAt }` while the breaker holds the install. `frozen`
  is true then, since nothing can trade; `frozenAt` and `agents` stay the owner's own freeze, what
  an unfreeze would lift. `LiveFactsView` gains `breaker?: true`, so the agent tells the owner why
  it cannot trade and suggests no unfreeze.
- **Additions to protocol v1:** the code `safety.breaker` in a new `safety` area, the reason
  `breaker`, and the optional fields of `safety/status`, `LiveFactsView`, `chat/deposit` and a
  notice part's `lists`.
- **Self-hosted** is never held by the breaker, so it sends none of them.

## Consequences

- An owner whose card was cancelled, whose proposal was refused or whose alert was skipped reads
  that bInference's breaker holds the agents and that a rescue still works, never a step that
  cannot help.
- A live intent whose first step landed and whose next step the service refuses ends
  `failed_onchain` with `signer_locked`, and its owner hears `notice.stepUnsent`. An approval the
  landed step left stands while the breaker holds: the service refuses a fill's reset to 0 too,
  and a revoke waits for the lift.
- At the lift, the reset of [decision 0211](0211-a-live-fill-holds-its-line-while-watched-and-leaves-no-approval-behind.md)
  cannot run for such a fill: the signer signs a reset under the fill's own grant only up to a
  minute after that grant ended, which a pull outlasts, and a reset under any other authorization
  is a new signer rule. So the lift tells the owner instead: one `notice.breakerApprovalLeft` for
  each approval a live order or rule fill left standing when the service refused its later step
  while the breaker held, naming the wallet, the spender and the allowance in its token, an
  unlisted one by what it answered, so the owner can revoke it. It reads every fill that ended
  `failed_onchain` with `signer_locked` from a minute before the breaker's row turned to pulled,
  page by page. The stored reason names no lock, so a key check's or a Privy app's lock in that
  window counts too; and a pull and a lift both missed while the engine was stopped leave such
  approvals untold, as they leave the pull and the lift untold. Live fills are off today, so no
  install meets this yet.
- **A known limit:** a sent step stuck at its nonce holds its wallet's queue until a block takes
  it or the drop rule drops it after its blocks
  ([decision 0115](0115-a-stuck-step-every-relay-refuses-is-dropped-and-ends.md)), since the
  service signs no speed-up or cancel of it; a rescue of that wallet waits behind it, as a rescue
  waits behind such a step under an owner's freeze.
- A user who froze an agent before the pull, and wants it to trade after the lift, unfreezes it
  after the lift; the lift's notice names it.
- Spec 1 gains section 7.17 and the code; spec 4 the three notices and the words of
  `reason.breaker` and `error.safety.breaker`; spec 6 the reason, first in its order.
- The runtime's two maps of `agent.frozen`, its chat relay and its goal desk, take `safety.breaker`
  too.

## Alternatives

- **Let an unfreeze through, which ends the owner's freeze and leaves the breaker's.** Its card and
  its notice would say the agent is unfrozen while nothing trades, and would need words of their
  own for that; the owner gains only an unfreeze that takes effect at the lift.
- **Let a revoke through with its card, as an owner's freeze does.** The owner would tap a card
  whose step the service then refuses.
- **Keep `agent.frozen`, with the breaker in its details.** Each surface would word one code two
  ways by a field, and those that do not read it would tell the owner to unfreeze.
- **Leave running turns alone.** A turn that runs on can propose nothing, but a freeze stops turns
  so the agent does not keep working towards a trade it cannot make; the breaker keeps that rule.
- **One notice per agent, as `notice.frozen`.** The breaker holds the whole install at once; one
  notice tells it.
