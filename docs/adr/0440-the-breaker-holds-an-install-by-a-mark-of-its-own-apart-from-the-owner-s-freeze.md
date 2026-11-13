# 0440. The breaker holds an install by a mark of its own, apart from the owner's freeze

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

An owner's freeze is stored on each agent's row, `agents.frozen_at`, and for a freeze of every
agent on the install's `safety` row too, `safety.frozen_at`, so every agent created while it holds
starts frozen ([decision 0128](0128-an-unfreeze-waits-for-the-owner-s-tap-on-its-card.md)). One
write marks them, cancels every unsigned intent but a rescue
([decision 0099](0099-a-freeze-leaves-a-pending-rescue.md)), pauses each active auto order and
cancels each one awaiting its card. An unfreeze clears the marks its card names and resumes the
paused orders in its own write. Some thirty reads in the engine and the stores ask whether an agent
is frozen through its record's `frozenAtMs`: the policy's `frozen` rule, the order and webhook rule
fills, the wake-ups, the schedules, goal turns, the turn start, launch drafts, and the store writes
that move an order or a rule into `active` only for an agent that is not frozen.

The breaker freezes every agent of every Cloud install with a freeze's rules, and lifting it ends
only its own freeze
([decision 0424](0424-the-cloud-breaker-is-one-row-only-binference-s-owner-moves-read-on-every-signature.md)):
an agent the owner froze stays frozen after the lift, and an owner's unfreeze never ends the
breaker's. Were the breaker to write the owner's marks, the lift could not tell them apart. The
engine learns of each pull and lift through `followBreaker`
([decision 0439](0439-the-engine-follows-the-breaker-through-a-profile-part-it-reads-every-second.md)).

## Decision

- **A mark of its own.** The install's `safety` row gains `breaker_at`, when the breaker's freeze
  took hold of the install, NULL while it does not; `breaker_version`, the last version of the
  breaker the install applied, 0 at first; `breaker_told`, the last version the owner was told of;
  and `breaker_pulled_at`, when the breaker's row turned to pulled for the last hold, as the
  source said, which outlasts the lift. Engine migration 0066 adds them, with its Postgres form.
  The breaker never writes `agents.frozen_at` or `safety.frozen_at`, and the owner's freeze and
  unfreeze never write the breaker's columns.
- **An agent is held** while the owner froze it or the breaker holds the install; an agent created
  while the owner's freeze of the install holds starts frozen. The stores answer it so, on SQLite,
  on Postgres and in the fakes alike:
  - an agent record's `frozenAtMs` is when the agent was held, by the owner or the breaker, the
    earlier of the two; `ownFrozenAtMs` is the owner's freeze alone, and `breakerAtMs` the
    breaker's;
  - the install's facts carry `breakerAtMs`, `breakerVersion`, `breakerToldVersion` and
    `breakerPulledAtMs` beside `frozenAtMs`;
  - every store write that checks a frozen agent in its own transaction reads both marks.

  So every read of `frozenAtMs` holds a braked agent as frozen with no change of its own, and a
  read that forgets the breaker refuses where it would have let work through. Only the freeze, the
  unfreeze and `safety/status` read `ownFrozenAtMs`.

- **The pull** is one write of the intent store's `freeze`, which gains a `breaker` part,
  `{ version, fromVersion, isPulled, changedAtMs?, isTold }`, and names no agent marks. With
  `isPulled` it sets `breaker_at`, keeping an earlier time, `breaker_pulled_at` when it takes hold,
  and `breaker_version`; cancels every unsigned intent of every agent but a rescue, with the cause
  `freeze`, so the rescue's guard holds as written; pauses each active auto order and cancels each
  one awaiting its card; and appends one `freeze` ledger entry for the install, by `breaker`. A
  breaker part is `stale` and writes nothing unless the install still holds `fromVersion`, the
  version its plan read, and its own version is above it, so two looks planned from the same
  state never both land.
- **The breaker's write moves on each agent whose orders it moves,** so an owner's freeze or
  unfreeze planned before it, on the orders it read then, is `stale` and plans again.
- **The lift** is the same write without `isPulled`. It clears `breaker_at`, sets
  `breaker_version`, resumes each paused order of an agent the owner has not frozen, to `expired`
  past its expiry as an unfreeze does, and appends one `unfreeze` ledger entry for the install, by
  `breaker`. Nothing the pull cancelled comes back.
- **The owner's freeze** writes the owner's marks whatever the breaker does: an agent held by the
  breaker alone gets its mark and `notice.frozen`, and stays frozen after the lift. **The owner's
  unfreeze** clears the owner's marks alone, and resumes a paused order only while the breaker does
  not hold.
- **A higher version that changes nothing,** pulled to pulled or lifted to lifted, writes the
  version alone, told with it.
- **Telling is kept.** A pull or a lift leaves `breaker_told` behind `breaker_version`. Its
  notices go first, each stored by the notice log before anything delivers it (decision 0133),
  then the install store's `tellBreaker` marks the version told; a look that finds a version untold
  tells it before it applies a newer one. A fault or a crash between the notices and the mark tells
  that version again at the next look, as a repeat: a repeated notice is harmless, a lost one
  leaves the owner without the reason nothing trades.
- **A restart while it is pulled.** Every agent is held from the first read of the stores, before
  the source answers. The startup's `followBreaker` writes only what changed while the engine was
  stopped: a pull it missed, whose cancels land before any confirmed intent goes to the executor; a
  lift it missed; or nothing. A pull and a lift both missed leave nothing held, write the version
  alone and tell nothing. On Cloud the move of an install to another worker is such a start.
- **Restores** keep the breaker's mark as the running install holds it, all four columns, and never
  carry the backup's; only the owner's own freeze of each agent is a guard a restore writes into
  `agents.frozen_at`. Self-hosted never sets the mark.

## Consequences

- Each rule of a freeze holds under the breaker through the same code, and neither a lift nor an
  unfreeze can end the other's freeze, by the write itself.
- Each pull and each lift is written once and told once, at least once across a fault, restarts
  and moves between workers.
- Each read of an agent also reads the one `safety` row: on SQLite from the same database file, on
  Postgres in the same transaction.
- The worker role gains `UPDATE` on the four breaker columns of `safety` (spec 3, section 6.6). A worker that clears the mark gains no signature by it: the signer service reads
  `cloud.breaker`, never this mark.
- The agent store, the install store, the order store, the webhook rule store and the intent
  store's `freeze` change with their contract suites, their fakes and both adapters together. The
  freeze, the unfreeze and `safety/status` move to `ownFrozenAtMs` in the same change.
- A property test holds that no sequence of the owner's freezes and unfreezes and the breaker's
  pulls and lifts ends the other's freeze, and that an auto order is paused exactly while its agent
  is held.
- Self-hosted gains two columns it never sets; nothing it does changes.

## Alternatives

- **The breaker writes the owner's marks.** The lift could not tell which agents the owner froze,
  and would unfreeze them all or none.
- **A breaker mark on each agent's row.** The install's one mark covers every agent, one created
  while it holds too, with no write per agent.
- **No stored state: each check reads the source.** The pull's cancels and pauses must be written
  anyway, and the lift must know which pauses were the breaker's. Held in memory, both are lost at
  each restart and each move to another worker, which would write and tell the pull again; the
  store writes that check a frozen agent in their own transaction cannot read a port; and a failed
  read at a start would leave the engine nothing to go on.
- **`frozenAtMs` stays the owner's, and each read asks for the breaker too.** Some thirty reads
  change, and one that is missed lets work through.
- **A cancel cause of the breaker's own.** Each reader of the `freeze` cause would need a twin, the
  rescue's guard among them, and the stored cause reaches no view.
