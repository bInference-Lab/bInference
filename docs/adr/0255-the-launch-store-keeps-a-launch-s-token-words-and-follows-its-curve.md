# 0255. The launch store keeps a launch's token words and follows its curve

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 3](../specs/database.md) section 2.6 gives `launches` one row per token a launchpad created,
insert-or-ignore on `(chain, token)`, its curve updated in place, and a launch a reorganization
removed deleted once its height is final. [Spec 1](../specs/protocol.md) section 8.3 shows each
launch with `assets`, so a surface can name its token, and counts `creatorLaunches30d`. The specs
leave open where a new token's symbol comes from, how a removed launch is found, and when the
count is taken. The facts:

- No registry lists a new launch's token, so `asset/get` and the notices show it by its address
  alone. Flap's create event carries the token's name and symbol; Genius.fun's token answers them
  ([decision 0254](0254-a-launchpad-reads-its-launches-from-their-transaction-s-logs.md)).
- The launch feed reads every block in order and, after a reorganization, reads again from the
  chain's last final block
  ([decision 0250](0250-the-leader-watcher-reads-every-block-once-within-a-budget-and-resumes-where-it-stopped.md)).
  A read then covers each block it holds whole.
- A token's address comes from its creator and salt, so a launch a reorganization moved lands in
  another block under the same token.
- `launch/list` filters on `creatorLaunches30d`, which changes as the creator launches again.

## Decision

- **Token words.** `launches` gains `symbol`, `name` and `decimals`, as the feed read them. A
  launch's `assets` name its token with them, never verified, and the registry's info wins for a
  token it lists.
- **One read, one truth for its blocks.** A read deletes the launches stored in its blocks that it
  no longer holds, in the same write that stores what it holds: a reorganization removed them. A
  token read again in another block moves there and stays one launch, never told again.
- **Curves.** A curve change of a stored launch updates its progress or graduation in place, and
  its `changed_at`; a later change in a read wins; a change of a token not stored is dropped.
- **Counted when read.** `creatorLaunches30d` counts the creator's launches stored with an earlier
  time, or the same time earlier in the chain, within the 30 days before, each time a launch is
  read, so a list and its filter agree.
- **Kept 90 days.** Each read deletes its chain's launches older than 90 days, as section 4 keeps
  them.

## Consequences

- Migration 0044 creates `launches` with an index on `(chain, block)` for the reorganization
  delete; a read covers at most 1,000 blocks.
- A launch told and then removed by a reorganization was told once; its alerts stay fired.

## Alternatives

- **Wait for finality before storing.** Every launch would come a few blocks late, while a launch
  alert is worth most in its first seconds. Rejected.
- **Store the count.** It would go stale with the creator's next launch. Rejected.
- **Read the token's words when a surface shows it.** One call per launch per view, for words
  that never change. Rejected.
