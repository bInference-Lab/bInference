# 0442. The runtime's link has a call budget of its own, and no turn stays running

Status: Accepted

Accepted by the tech lead on 2026-11-13. Amends
[decision 0174](0174-a-restarted-runtime-repairs-its-turns-and-chat-waits-in-one-queue-per-agent.md):
the engine shows no repaired turn's status line for a turn it ended itself with its own line, the
last such turn of each agent since it started.

## Context

The protocol server gives every connection a call budget on the engine's clock: 60 calls at once,
then 20 a second ([spec 1, section 2](../specs/protocol.md#section-2)). A call over it fails
`protocol.busy`, retryable, before the server reads its key or runs its handler, so a refused write
leaves no mark ([decision 0437](0437-an-idempotency-key-is-marked-started-in-the-store-before-its-write-runs.md)).

The agent runtime signs in over IPC with the token the engine made at its current start
([spec 8, section 2.1](../specs/runtime.md#section-2-1)). It is the only token of kind `runtime`:
each start revokes the one before, and `token/register` makes `mcp` and `custom` tokens only, so no
outside client holds one. Its one connection carries every agent's turns, their helpers
([decision 0403](0403-the-agent-hands-bounded-work-to-helpers.md)) and their tools, under the same
budget as an outside client. Up to 4 agent turns run at once, and each agent runs up to 4 helpers.

On an installed engine a turn makes 13 calls before its first model call (`inbox/take`, six
workspace files, the skills, the skill proposals twice, the live facts, `turn/start`); then a draft
at most every 250 ms while its model writes and a reasoning draft as often while it reasons
([decision 0371](0371-a-running-turn-streams-its-text-and-tool-lines-to-one-status-message.md)), a
read and a progress line per tool, `usage/record` per model call, and its end. A helper makes
`usage/record` per model call, its tools' reads, and `helper/ended` at its end.

Measured on the composed engine with the runtime in the test's process and a scripted model, all
on one manual clock, the engine answering at once as over local IPC. A realistic model sends its
first event after 1.2 seconds, then a piece every 40 ms: 75 pieces of text, after 50 of reasoning
in the reasoning runs. An instant model answers at once, as a fast or cached one can. Each round of
tools is three reads; an agent asked to research starts 4 helpers, and each helper reads twice and
reports. The test's engine serves no skill proposals, so each of its turns makes one call fewer.
The calls each run asks for are counted under a budget that refused nothing; the refusals are
those today's budget makes in the same run. Helpers' reports that merge into one turn change how
many calls a run makes, so the instant run of 4 agents gives the most seen at once over several
runs:

| Run                                 | Calls | In the busiest second | Refused today | What went missing today                                 |
| ----------------------------------- | ----: | --------------------: | ------------: | ------------------------------------------------------- |
| One turn, realistic                 |    33 |                    11 |             0 |                                                         |
| One turn, reasoning                 |    43 |                    11 |             0 |                                                         |
| One turn, instant                   |    22 |                    22 |             0 |                                                         |
| A turn and 4 helpers, realistic     |   109 |                    28 |             0 |                                                         |
| A turn and 4 helpers, instant       |    87 |                    87 |            12 | the turn's end, 4 helper reports, 4 usage records       |
| 3 agents at once, realistic         |    99 |                    33 |             0 |                                                         |
| 3 agents at once, instant           |    66 |                    66 |            10 | 2 of 3 turns' ends, with their answers and status lines |
| 3 agents, 4 helpers each, realistic |   327 |                    84 |            72 | 57 reads, all 12 helper reports, a usage record         |
| 3 agents, 4 helpers each, reasoning |   387 |                    87 |            71 | 57 reads, 3 helper reports, 9 `inbox/take`              |
| 4 agents, 4 helpers each, realistic |   436 |                   112 |           120 | 2 of 4 turns' ends, 16 helper reports, 12 usage records |
| 4 agents, 4 helpers each, instant   |   319 |                   319 |       not run |                                                         |

What a refused call does today:

- `turn/say` with `final: true`, `turn/status`, `usage/record` and `turn/end` are each one write of
  the turn's end, given up after its first failure
  ([decision 0172](0172-the-turn-loop-bounds-every-wait-and-answers-only-what-it-can.md)). The
  runtime ends the turn `failed`, but the engine still holds it and pushes no `chat/turnEnded`, so
  the console and Telegram show it running for good.
- A refused `usage/record` leaves a model call uncharged against the agent's budget.
- `helper/ended` is dropped on any failure: the agent never hears its helper's report.
- A refused `inbox/take` leaves its message untaken until the next listing.
- A refused read reaches the model as a failed tool.

The engine also clears its running turns when the runtime exits, and tells no surface.

## Decision

- **The runtime's budget.** A connection signed in with a token of kind `runtime` gets a budget of
  its own: 400 calls at once, then 100 a second, from `ServerLimits` (`runtimeCallBurst`,
  `runtimeCallsPerSecond`). Every other connection keeps 60 and 20. Every other bound holds for the
  runtime as for any client: 64 calls in flight, 1 MiB frames, the writes running at once. The
  sign-in reads the token's kind from the stored token, never from the client kind the `open`
  frame names, and the server makes the connection's budget at `ready`.
  The burst covers the install's 4 running turns each starting 4 helpers on an instant model, at
  most 319 calls at once in the runs above; the rate is more than twice the 45 a second that 4
  agents with helpers ask on average over their 10 seconds. Measured again under this budget, every
  run above ended every turn, delivered every helper's report and refused nothing.
- **One connection per runtime token.** A token of kind `runtime` holds one connection: its newest
  sign-in ends the older ones with `bye` `auth.revoked`. The runtime's client opens a new
  connection only once its old one closed, so a reconnect works, and a process that holds the token
  cannot multiply the budget with more connections.
- **Retries.** The runtime sends a call again only when the call never ran.
  - The engine refused it `protocol.busy` or `engine.starting`, both answered before the server
    reads its key. The runtime retries it through core's `retry`: at most 5 attempts, so at most 4
    waits, each with full jitter under 250 ms doubling up to 2 seconds, 3.75 seconds of waits in
    all. The caller's own signal bounds the rest.
  - The runtime's own client refused it `client.busy` before sending it, with its 60 calls waiting
    for an answer. The call waits until one of the link's calls settles, or a second passes, for a
    slot a call of the client's own held, then goes again, for as long as its caller's signal
    allows: an end write's 10 seconds, a tool's time for a read, the runtime's lifetime for a
    wake-up. Such a wait counts as no attempt.
  - Every other failure, `engine.timeout` and `engine.stopping` among them, is not sent again,
    since the call may have run.
  - This holds for the turn's own calls: `turn/start`, `turn/mark`, `turn/say` with
    `final: true`, `turn/status`, `usage/record` and `turn/end`; for `inbox/list` and
    `inbox/take`; for the wake-ups the runtime sends: `helper/ended`, `goal/continue`,
    `image/made` and `media/made`; for the goal's line, `goal/show`; for the owner's images a turn
    reads, `inbox/readImage`; and for every read a tool or a turn's context makes: an operation of
    the `read` scope that is no write, such as `portfolio/get`, `quote/get`, `agent/readFile` or
    `facts/get`.
  - Drafts, progress lines and reasoning are not sent again: the feed gives each up and the next one
    replaces it. A tool's call other than a read is not sent again: its result tells the model. A
    proposal is never sent again (spec 8, section 6.1).
  - A write keeps one key across its attempts. The final text and the end take keys named by their
    turn, `<turn>.say` and `<turn>.end`, as `usage/record` takes `<turn>.usage.<n>` today. A resend
    over a new connection, which the client makes for a call still waiting, then answers the first
    result, or `protocol.outcome_unknown` for a key a stopped engine left started (decision 0437);
    none runs twice. `turn/status` is no write and carries no key: it is sent again only after one
    of the refusals above, when it never ran, so a resend never runs it twice. A call still waiting
    when the connection drops goes out again on the next one, as for every client, so a line or a
    wake-up with no key whose answer the drop lost can still run twice; that holds before this
    decision too.
- **Room on the link.** At most 40 reads of tools, contexts and the owner's images run at once on
  the runtime's link; the rest wait their turn in the runtime, first come first served, and are
  never refused for room. The client's other 20 places are left to the turns' own calls, usage
  records and wake-ups, so with reads that take seconds, a closing call still finds a place within
  its own time.
- **A turn whose end never lands.** The engine ends a running turn it holds as `failed` and logs
  `chat.turn_lapsed` with the agent, the turn and the cause, in three cases:
  - the runtime exits, where today it clears every running turn without a word;
  - the agent's next `turn/start` arrives while the engine holds an earlier turn of that agent: the
    runtime runs one turn per agent, so the earlier one is over, and its end goes out before the new
    turn's `chat/turnStarted`;
  - one minute past the turn's own limit after its `turn/start`, 11 minutes: a turn has 10
    minutes, a stop's grace 5 seconds, and the usage record of the model call the stop cut and
    each of its end writes at most 10 seconds. The limit is one constant, `maxTurnMs` of
    `@binference/protocol`, which the runtime's turn limit and the engine's deadline both read, so
    the two never drift; it lives in the protocol since the engine may not import the runtime.

  The engine first pushes the status line `turn.failed.lapsed` for the turn, which says that it
  stopped and that a proposal it made may be waiting on a card, to be checked before the owner asks
  again; then `chat/turnEnded`. Telegram then shows that line and never its "try again" line for
  a turn with no answer. Each listener of the lapses runs on its own: one that throws is logged and
  never fails the `turn/start` that replaced the turn or the runtime's exit.

  A runtime that starts again repairs each turn it left unfinished and sends its line as decision
  0174 has it, `turn.failed.proposalUnknown` or `turn.failed.engine`. The engine remembers, in
  memory, the last turn that lapsed of each agent since it started, for at most 1,000 agents,
  forgetting the agent whose turn lapsed longest ago past them (`lapsedAgentsKept`). It shows no
  status line for a remembered turn that no longer runs: the owner read its `turn.failed.lapsed`,
  so a lapse and the repair after it show one line. After the engine and the runtime stopped
  together, such as on a machine that lost power, the engine remembers nothing and the repair's
  line shows, as before this decision.

  A `turn/end` the runtime sends later for that turn still pushes `chat/turnEnded`, which every
  surface leaves alone for a turn it no longer shows. A proposal from the runtime after the engine
  ended its turn takes no turn's mark and counts as outside content, as any proposal with no
  running turn does (spec 8, section 4.3).

## Consequences

- No run measured, up to 4 agents each with 4 helpers, meets the runtime's budget, and a fault in
  the runtime that loops on calls still stops at 100 a second, on the one connection its token
  holds.
- The owner never sees a turn running for good: at worst a lost end shows at the agent's next turn
  or 11 minutes after its start, and every surface then reads `turn.failed.lapsed`, which sends the
  owner to the open cards before they ask again.
- Helpers' reports, usage records and taken messages no longer go missing to a refusal the engine
  or the runtime's own client makes under load: with reads that take 3 seconds, 4 agents with 4
  helpers each charged every model call once and heard every report.
- A turn the engine ended itself and the runtime then repairs shows one line,
  `turn.failed.lapsed`, where decision 0174 would add `turn.failed.engine` or
  `turn.failed.proposalUnknown`; the lapse line names the open cards too. After a stop of both,
  such as a power cut, the repair's line shows as decision 0174 has it. The record of lapsed turns
  lives in the engine's memory, one turn per agent, at most 1,000 agents.
- `ServerLimits` gains `runtimeCallBurst` and `runtimeCallsPerSecond`, and the server's identity of
  a sign-in carries the kind of token it signed in with. No operation, error code or push changes in
  protocol v1; spec 4 gains the status line `turn.failed.lapsed`.
- The engine's running turns keep one timer per turn on the engine's clock, and the protocol
  exports `maxTurnMs`, which the runtime's `turnLimits` reads in place of its own number.
- Spec 1, section 2 names the runtime's budget and its one connection; spec 8, sections 2.4 and
  4.3 name the retries, the room on the link and the engine's ends; spec 4 names the line.
- Past the install's 4 running turns, the helpers of agents whose turns ended still call; an
  install of many agents with helpers can still meet the budget, and then the retries carry the
  turn's own calls, a draft drops and a read waits.

## Alternatives

- **Keep the shared budget.** The runs above lose turns' ends, helpers' reports and usage records
  with 3 agents and their helpers on a realistic model, and with 3 agents, or one agent and its
  helpers, on a fast one.
- **No budget for the runtime.** Its own pacing bounds it in normal use, but nothing would bound a
  fault in it but 64 calls in flight, and each keyed write costs the store two syncs to disk
  (decision 0437), on the store the money path writes through.
- **A budget per agent on the runtime's connection.** The server would read each call's args to
  find its agent; it is the transport and reads no args. One budget for the runtime, sized for the
  install's 4 running turns, bounds the same.
- **The runtime paces itself under the shared budget.** It would queue its calls: the 436 calls of
  4 agents with helpers, asked in 10 seconds, would take 19 to serve, the last 9 seconds late, and
  the owner's drafts with them.
- **Exempt the closing calls from the budget.** The server would judge operations by meaning, and
  reads, wake-ups and `inbox/take` would still be refused.
- **Retry every retryable code.** After `engine.timeout` a call may have run: a status line would
  show twice, and a write's same key would answer `protocol.outcome_unknown`.
- **End a running turn when the runtime's connection drops.** The client reconnects and sends its
  waiting calls again, and the turn runs on.
- **Let each surface time out a running turn.** Each would guess; the engine holds the turn and
  knows when it started.
