# 0172. The turn loop bounds every wait and answers only what it can

Status: Amended by 0173

Accepted by the owner on 2026-10-12.

## Context

A second review of the turn loop of [spec 8](../specs/runtime.md) found cases where it hung, lost a
message, sent a proposal after a stop, misled the owner, or let a model's arguments break a batch.
[Decision 0171](../DECISIONS.md#d0171) settled six open cases of the loop; two of its points need
more:

- It runs no call of a cut-off response, but the conversation sent back still held the call's
  half-written arguments, which the Messages API and many gateways refuse.
- It wrote a stopped turn's end with the runtime's lifetime, but a write that threw or never
  answered still left the turn without its end, and the engine with a running turn.

The other cases are new:

- A tool or a model stream that ignores its signal held the turn past its 60 seconds, its stop and
  its 10 minutes, and a hung read held its whole parallel batch.
- A merge point took a waiting message where no model call could answer it: after `ask_owner`, in a
  batch past the tool call limit, at the model call limit, after a stop.
- A stop that landed while a proposal was written still sent it.
- A committed turn said its proposal waits for the owner even when the engine refused it.
- Arguments nested 1,500 deep overflowed the stack in the JSON check; a key written twice resolved
  silently to its last value; an integer past 2^53 written as `1e21` was rounded.

## Decision

- **Every wait is bounded by the loop.** Each tool call and each event of a model stream is raced
  against its signal and settled one clock tick after the signal aborts: a read or control call
  gets its timeout or stop result, and the stream ends `aborted`. A proposal with no answer by its
  deadline, or with an answer only after it, has an unknown outcome: the turn halts `failed`, and
  the call is never sent again.
- **A merge point takes messages only where a model call can follow:** the turn is neither halted
  nor committed, is under its model call limit, and its batch neither asked the owner nor went past
  the tool call limit. Otherwise the message stays in the chat queue and starts the next turn.
- **A stop checked before the send.** After a call is written and before its tool starts, a stop
  keeps it from starting; a proposal so stopped is never sent, and the turn stays committed.
- **The status line follows the engine's answer.** A committed turn says its proposal waits only
  when the engine took it; a refusal ends with its own line. A propose tool returns an error only
  for a certain refusal, and throws on anything uncertain.
- **Cut-off calls go back empty.** The conversation carries each call of a cut-off response with
  empty arguments beside its "not run" result; the transcript keeps what the model wrote. Calls of
  a cut-off response past the 25th get the limit's result and end the turn `loop`, as for any call.
- **A port that throws ends the turn `failed`.** The turn halts, each call written without a result
  gets one as far as the journal still takes writes (a proposal's outcome unknown), and the final
  text, the status line, the journal end and `turn/end` are each best effort under their own 10
  seconds. A `turn/start` that throws leaves the turn unstarted, its messages waiting.
- **Arguments are refused before they are read** when over 65,536 characters, nested deeper than
  64 levels, holding a key twice in one object, or holding an integer past 2^53 not written as plain
  digits. A tool box that throws refuses only that call.
- **Tools declare strict schemas that never coerce.** A tool whose schema coerces anywhere, whose
  objects allow fields they do not name, or that cannot be written as JSON Schema is refused when it
  is declared.

## Consequences

- No tool, provider or plugin can hold a turn, a batch or a stop past its bound; a call left
  running settles into nothing.
- A message is answered by the turn it joins, or by the next one; none is written as joined and
  left unanswered.
- The owner never reads that a card waits when none does, and never gets a card after pressing
  stop, unless the proposal had already gone to the engine.
- The next turn's model call accepts the conversation after a cut-off response.
- The engine's running turn ends with every turn the runtime ran, except when the runtime itself
  exits, which clears every running turn.
- A model that writes amounts as numbers past 2^53 in another form, or repeats a field, reads why
  and writes them again.

## Alternatives

- **Trust tools and transports to honour their signal.** A plugin or a client that drops it would
  hang the agent. Rejected.
- **Let a message join wherever a merge point is.** It would be written as joined and never
  answered. Rejected.
- **Strip the calls of a cut-off response from the conversation.** The model would not see what
  happened to them. Rejected.
- **Treat a port that throws as fatal to the runtime.** The engine would keep the turn running until
  the runtime restarted, and one slow write would stop every agent's chat. Rejected.
