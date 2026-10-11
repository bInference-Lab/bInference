# 0171. The turn loop marks at once, counts every call, and runs no cut-off call

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) sets the turn's states, its tool batches, the committed turn and its
limits. Building the loop met six cases it leaves open:

- **When the mark reaches the engine.** Section 4.3 says the runtime waits for `turn/mark` before
  its next model call. A batch can hold a read whose result is outside content and, after it, a
  propose call. The engine gives a runtime proposal the mark its running turn has when the proposal
  arrives ([spec 6, section 5](../specs/intent-states.md#section-5)).
- **A mark the engine does not take.** The section does not say what the turn does then.
- **Which calls count toward the 25.** Section 9 caps tool calls at 25 a turn, but a model also
  makes calls that never run: unknown tools, arguments that fail, held-back proposals.
- **A response cut off at its output limit.** Its last call's arguments may be half written.
- **A propose call that throws or times out.** Section 6.1 calls its outcome unknown and ends the
  turn `failed`; a stop at the same time ends it `stopped`.
- **The writes of a stopped turn.** Section 5.3 gives every call that did not run a result, and
  section 11 writes the turn's end, after the stop.

## Decision

- A tool result or a joining message that holds outside content marks the turn at once: `turn/mark`
  is answered before the batch's next call starts, so a proposal later in the same batch carries
  the mark too.
- A `turn/mark` that fails halts the turn: no later call runs, each gets "not run", and the turn
  ends `failed` with the status line's class `engine`.
- Every call the model makes counts toward the 25, run or not. A turn of exactly 25 calls goes on;
  the turn ends `loop` only when a call goes past the 25th, and that call does not run.
- A response cut off at its output limit runs none of its calls. Each gets "not run: the response
  reached its output limit before this call was complete", and the turn goes on to its next model
  call, within the 40 a turn.
- A propose call whose tool throws, or that has no answer within 30 seconds, has an unknown outcome
  and halts the turn `failed` with the class `proposal_unknown`. When the turn was stopped first,
  the stop is the reason, and the turn ends `stopped`.
- A turn's writes to its journal and to the engine use the runtime's lifetime, not the turn's stop,
  so a stopped turn still writes the results of the calls it did not run, its final text and its
  end.

## Consequences

- A turn never sends a proposal that the engine reads as clean after the turn saw outside content,
  even within one batch. The cost is one `turn/mark` round trip on the local socket per marked turn.
- A turn the engine could not mark fails closed: it proposes nothing more.
- A loop of refused calls reaches the cap as fast as a loop of calls that run.
- A model that writes a call too long for its output limit sees why and may write a shorter one.
- The engine's turn operations need a timeout of their own; the protocol client's call timeout is
  that bound.

## Alternatives

- **Mark only before the next model call,** as section 4.3 reads. A proposal later in the batch
  would reach the engine before the mark. Rejected.
- **Go on after a failed mark.** The engine would read the turn as clean. Rejected.
- **Count only the calls that run.** A model that repeats a refused call would never reach the cap.
  Rejected.
- **Drop the calls of a cut-off response from the transcript.** The model would not see what
  happened to them, and the turn would end with a half answer. Rejected.
