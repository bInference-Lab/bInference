# 0174. A restarted runtime repairs its turns, and chat waits in one queue per agent

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

The agent runtime of [spec 8](../specs/runtime.md) now keeps its sessions in `agent.sqlite`, takes
the engine's inbox into its chat queue, and runs turns through the engine. Spec 8 sections 2.4, 3
and 4 leave some cases open:

- **Sessions.** The engine names sessions, but nothing says when the runtime writes a session's
  row, or what its `surface` and `conversation` hold for a settle message.
- **Merging.** Section 3.4 says "a message" joins a running turn in `merge` mode, without saying
  whether a settle message may, or how the model reads one.
- **Stop and clear.** Invariant 8 needs every message taken into a turn or dropped with a reason,
  but `inbox/stop` and `inbox/clear` start no turn, and the messages they end need a reason too.
- **A refused start.** Section 4.1 says a refused turn's messages "stay or are skipped by kind",
  and section 8.3 says when a budget turn starts again, but not when an `unavailable` start is tried
  again, or what happens to the messages of an archived or unknown agent.
- **A repaired turn.** Section 2.4 ends a turn the runtime finds unfinished `failed`, and spec 4
  gives `turn.failed.proposalUnknown` when its proposal's outcome is unknown, but no line for a
  repaired turn without one.
- **A refused proposal.** A committed turn whose proposal the engine refused has no status line in
  spec 4.
- **Loading.** Invariant 3 needs every call in what the model sees to have exactly one result, and
  a stored transcript can hold a call with none, or a result after a message that joined.
- **Grants.** [Decision 0168](../DECISIONS.md#d0168) lets the built runtime start no worker, and
  `agent.sqlite` is served by store workers, so that no query blocks the runtime's main thread.

## Decision

- **The runtime opens a session's row from the first message that names it.** Its `surface` and
  `conversation` are the owner's surface for an owner's message, and `engine` for any other.
- **Each agent runs one turn at a time, from one queue.** The queue holds the messages of the
  agent's open session in arrival order. A turn takes the waiting messages, oldest first, up to 20,
  under the turn id the engine reserved for the first; at most 4 turns run in the install.
- **Every message that can start a turn may join one** at a merge point in `merge` mode, owner and
  settle messages alike. A settle message reaches the model as one line that names the intent, its
  kind and its state.
- **Stop and clear apply at once.** Each is written to the chat queue before `inbox/take`, applied,
  then dropped `applied`. A stop halts the running turn and drops the messages that waited before it
  `stopped`; a clear halts it, drops them `cleared`, waits for the turn to end, then closes the
  session. One found waiting at a start is applied then.
- **A refused start.** `archived` and `not_found` drop the turn's messages with that reason.
  `frozen` drops them `frozen`; the engine refuses only schedule and alert turns so. `budget` keeps
  them waiting until `resumesAt` when the engine names it, else until the agent's next message.
  `unavailable` keeps them waiting and tries again after 30 seconds, or at the agent's next message.
- **A repaired turn's status line** is `turn.failed.proposalUnknown` when it holds a proposal whose
  outcome is unknown, else `turn.failed.engine`. It goes out with the turn's `turn/end` once the
  runtime is connected, before `ready`.
- **A refused proposal sends no status line.** `intent/propose` answers a refusal by policy or risk
  with an intent already terminal (`rejected_policy`, `risk_blocked`), and its settle message
  starts the turn in which the agent reports it.
- **The conversation is repaired as it loads.** Each call's result follows the response that made
  it; a second result of a call, or one with no call before it, is left out; a call with no result
  gets "not run: the agent restarted"; an owner message stored between a call and its result moves
  after the results; arguments that are not a JSON object go back as `{}`. The transcript itself
  never changes.
- **The built runtime may start worker threads.** `runtimeNodeArguments` grants
  `--allow-worker`, a read of the store worker's bundle beside the entry, and a read and write of
  `agent.sqlite` and its `-wal`, `-shm` and `-journal` files, each path named alone; this amends
  decision 0168. The workspace is granted with the tools that use it.

## Consequences

- Every message the engine stored ends in exactly one turn, or dropped with a reason the queue
  keeps (invariant 8), across stops, clears and restarts.
- A crash between a call and its result, or between a proposal and its answer, leaves a session
  every provider accepts on the next turn, and the owner reads why the turn ended.
- The owner never reads a "waits" line for a card the engine refused; the agent says so in the turn
  the settle message starts.
- An agent whose engine is out of reach tries again on its own, at most every 30 seconds.
- Node writes a security warning to the runtime's standard error for `--allow-worker`. A store
  worker runs under the same permission model as the runtime.

## Alternatives

- **Write a session's row only from the engine's push of a new session.** It needs a push kind the
  protocol does not have, for a row the first message already names. Rejected.
- **Let only owner messages join a turn.** A settle message waiting behind an owner's message
  would split the queue's order. Rejected.
- **Drop a stop or clear without writing it.** A crash before `inbox/take` would apply it twice, or
  never. Rejected.
- **A status line of its own for a repaired turn.** Spec 4's engine line already says the agent
  starts again by itself; a new key adds words for the same fact. Rejected.
- **Open `agent.sqlite` on the runtime's main thread.** It breaks the store's rule that no query
  blocks the main thread, and needs a second way into the database. Rejected.
