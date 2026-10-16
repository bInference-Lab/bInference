# Spec 8: the agent runtime

Status: accepted by the owner on 2026-10-11, with the recommendations of its open questions. Its
proposal rule is [decision 0167](../DECISIONS.md#d0167), accepted on 2026-10-10. Amended by
[decision 0191](../DECISIONS.md#d0191) (usage records and the loop notice) and
[decision 0207](../DECISIONS.md#d0207) (where skills live, how they are read and installed) and
[decision 0221](../DECISIONS.md#d0221) (the model check).

The agent runtime is the process that runs each agent's model loop: sessions, context, tools,
compaction and model calls ([ARCHITECTURE.md section 4](../ARCHITECTURE.md#section-4)). It is a
client of the engine like any other, with the scopes `read`, `propose` and `agent`
([spec 1, section 4.1](protocol.md#section-4-1)). It holds no key, confirms nothing and writes no
money state. It owns `agent.sqlite` ([spec 3, section 3](database.md#section-3)), and reads each
agent's workspace files from the engine with `agent/readFile` ([decision 0200](../DECISIONS.md#d0200)).

<a id="section-1"></a>

## 1. Words

- **Session**: one conversation between the owner and an agent (`ses_…`). An agent has one open
  session at a time, shared by every surface: Telegram, the console and terminal chat show the same
  conversation. `chat/clear` closes it and opens the next.
- **Turn**: one run of the loop (`trn_…`), from the messages that start it to its end. A turn makes
  model calls and runs tool batches.
- **Model call**: one request to a model and its streamed response.
- **Tool batch**: the tool calls of one model response.
- **Agent inbox**: the engine's durable store of messages for the runtime (section 3.2).
- **Chat queue**: the runtime's durable queue of messages taken from the agent inbox, one per open
  session, width 1 (section 3.4).
- **Merge point**: a place in a turn where a waiting message may join it (section 3.4).
- **Committed turn**: a turn in which a propose tool's body started (section 6.1).
- **Transcript**: a session's append-only events in `transcript_events`.

<a id="section-2"></a>

## 2. The process

<a id="section-2-1"></a>

### 2.1 Start

- The engine starts one runtime process per install, for all its agents, as a child process with
  pipes only the engine holds and an empty environment. The runtime reads no environment variable,
  no config file, no `engine.sqlite`, nothing in `keys/` or `auth/`.
- It starts after the protocol server listens, so it can connect, and it runs whether the engine is
  locked or not: a proposal waits for the keys like any other.
- At each start the engine makes a new client token for it (`tokens.kind` `runtime`, scopes `read`,
  `propose` and `agent`), stores only its hash, and revokes the previous runtime token in the same
  write. The token lives in the two processes' memory only.
- Node's permission model limits the runtime's files to its own package, `agent.sqlite` and
  `workspace/`, and lets it start no child process. The owner's shell, file and browser tools
  ([rule 15](../ARCHITECTURE.md#rule-15)) widen only what each one needs when turned on.
- Start order inside the runtime: read the `start` line, open and migrate `agent.sqlite`, take the
  writer fence, repair unfinished turns (section 2.4), connect to the engine, subscribe to `inbox`,
  read the untaken messages with `inbox/list`, then write `ready`.

<a id="section-2-2"></a>

### 2.2 The control pipe

The engine and the runtime also talk over the child's standard input and output, one JSON line per
message, zod-checked on both sides. Everything else goes over the protocol.

| Line         | From    | Fields                                                                                                    |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `start`      | engine  | `token`, `endpoint` (the IPC address), `paths` (`agentDb`, `workspace`), `settings`                       |
| `settings`   | engine  | `settings`, sent again whole after a reload changes a key the runtime uses                                |
| `route`      | engine  | `id`, `op`, `args`, `origin` (`owner`, `agent`, `untrusted` or `system`): a routed operation (section 10) |
| `stop`       | engine  | none: the shutdown order has begun                                                                        |
| `ready`      | runtime | `version`, `schemaVersion`                                                                                |
| `routeReply` | runtime | `id`, then `result` or `error` (a spec 1 error)                                                           |
| `health`     | runtime | `runningTurns`, `waitingMessages`, `lastModelError?`; every 10 seconds                                    |

`settings` holds what the runtime needs and nothing more: `models` (spec 2, section 6.3) with each
provider's key already resolved from its secret source, `chats.newMessageMode`, the search
providers and their keys, and the owner's locale and timezone. A reload applies to the next model
call; a running call keeps its settings.

<a id="section-2-3"></a>

### 2.3 Health, restarts and stopping

- **Health.** `binference status` shows a `runtime` signal: `ok` after `ready`, `fail` while the
  process is down or starting, with the time it went down. A runtime that writes no `ready` within
  30 seconds of its start is killed, and the start counts as failed.
- **Restarts.** When the runtime exits, the engine starts it again at once, then after 2, 4, 8, 16,
  32 and 60 seconds for each failure that follows, and every 60 seconds after that. A runtime that
  stayed up 10 minutes resets the wait. While it is down, routed operations fail
  `runtime.unavailable`, `chat/post` is still stored, and the engine keeps every inbox message.
- **Stopping.** The runtime stops first in the engine's shutdown order
  ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)). On `stop`, it ends each running
  turn as `inbox/stop` does (section 4.4) but keeps the waiting messages for its next start,
  waits up to 5 seconds for a propose call already sent, closes `agent.sqlite` and exits. The engine
  kills it 10 seconds after `stop`.
- **Writer fence.** Each start raises the fence in `agent.sqlite`'s `meta`, and every transcript
  write checks it in its transaction, so a runtime left over from before can write nothing.

<a id="section-2-4"></a>

### 2.4 After a crash

Before `ready`, the runtime repairs each turn with no `ended_at`:

1. Every tool call without a result gets one. A propose call whose committed mark is stored gets
   "the outcome of this proposal is unknown after a restart; it was not sent again". Any other
   call gets "not run: the agent restarted".
2. The turn ends `failed`, and its `turn/end` is sent once the runtime is connected.
3. Nothing is proposed again. The new start has a new token, so the engine's idempotency store,
   kept per credential, could not catch a second send. If the proposal reached the engine, its
   settle message arrives as usual and starts a turn (section 3.3).

The messages the unfinished turn took stay in it. Waiting messages stay in the chat queue, and
untaken ones come back from `inbox/list`.

<a id="section-3"></a>

## 3. Sessions, the agent inbox and the chat queue

<a id="section-3-1"></a>

### 3.1 Sessions

- The engine names sessions and reserves turn ids, so `chat/post` and `chat/clear` answer while
  the runtime is down. The open session of each agent is `agents.chat_session_id` in
  `engine.sqlite`; the first message opens one.
- The runtime keeps each session's row, turns and transcript in `agent.sqlite`, under the engine's
  ids. `sessions.surface` and `conversation` record where the session began.
- `chat/clear` stores an `inbox/clear` message and a new session id in one write.

<a id="section-3-2"></a>

### 3.2 The agent inbox

- Every message for the runtime is a row of `agent_inbox` in `engine.sqlite` (`msg_…`), written in
  the transaction of the event that causes it: before `chat/post` replies, with the intent's
  terminal state, with the schedule's run. The engine then pushes it on the `inbox` topic.
- Each message that can start a turn carries a turn id the engine reserved for it. `chat/post`
  answers that id: the turn the message starts if it starts one. A message that joins a running
  turn leaves its reserved id unused.
- The runtime writes each message it receives into its chat queue, then calls `inbox/take` with
  its id; the engine sets `taken_at`. A message already in the queue is ignored, so a message
  pushed twice or read again from `inbox/list` is taken once.
- On start and after a `resync`, the runtime reads every untaken message with `inbox/list`, oldest
  first.
- The engine keeps at most 200 untaken messages per agent. Past that, `chat/post` fails
  `protocol.busy`, and a message the engine makes is dropped and logged; its facts still reach the
  owner as cards and notices.

<a id="section-3-3"></a>

### 3.3 Inbox messages and what each starts

Every message carries `message`, `agent`, `session` and `at`; one that can start a turn also carries
its reserved `turn`.

| Kind                  | Sent when                                                                                                  | Its own fields                                                   | What it does                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `inbox/message`       | The owner writes on a surface, or presses a button of the agent's question                                 | `text`, `images?`, `surface`, `answer?` (`{ question, choice }`) | Starts a turn, or joins the running one (section 3.4)                                                |
| `inbox/intentSettled` | An intent the agent runtime proposed reaches a terminal state ([spec 6](intent-states.md#section-2))       | `intent` (an `IntentView`)                                       | Starts a turn: the agent reports, and may propose its next step                                      |
| `inbox/orderSettled`  | An auto order the agent runtime created leaves `awaiting_confirmation`: `active`, `cancelled` or `expired` | `order` (an `OrderView`)                                         | Starts a turn                                                                                        |
| `inbox/scheduleDue`   | A schedule's time comes ([ARCHITECTURE.md section 26](../ARCHITECTURE.md#section-26))                      | `schedule`, `prompt`, `due`, `outsideContent`                    | Starts a turn; skipped while the budget is spent or the agent is frozen                              |
| `inbox/alertFired`    | An alert with `wake` fires (spec 1 gains it with alert wake-ups)                                           | `alert`, what fired it, `outsideContent`                         | Starts a turn; skipped while the budget is spent or the agent is frozen                              |
| `inbox/resumeReport`  | The engine was off and checked the orders at its start                                                     | the counts of `notice.resumed`                                   | Starts no turn; the next turn sees it                                                                |
| `inbox/stop`          | `chat/stop`, a freeze of the agent or the install                                                          | `reason` (`owner`, `freeze`)                                     | Ends the running turn and drops the messages that waited before it (section 4.4)                     |
| `inbox/clear`         | `chat/clear`                                                                                               | `next` (the new session)                                         | Ends the running turn, drops the waiting messages, closes the session; the next message opens `next` |

- A skipped message is marked dropped in the chat queue with its reason; nothing tells the owner
  twice, because the engine already sent the notice that explains it.
- A schedule's run stores no `inbox/scheduleDue` while its agent is archived or frozen, while its
  budget of the day is spent, or while the schedule's last wake-up is untaken; the run is recorded
  as skipped ([decision 0232](../DECISIONS.md#d0232)). `due` is when the run was due, earlier than
  `at` for a run missed while the engine was off or locked. The model reads the prompt with the
  schedule's id and `due`.
- In a settle message, an asset the registry does not list shows by its address with the words
  "unlisted token", never by the name or symbol its deployer chose (section 5.4).
- A question's answer arrives as `inbox/message` once: the engine passes on the first press of a
  button and ignores the rest, and a press after the session was cleared does nothing.

<a id="section-3-4"></a>

### 3.4 The chat queue and its modes

The chat queue holds the messages of the open session that no turn has taken yet, in arrival order.
At most one turn runs per agent, and at most 4 across the install; a turn that cannot start yet
waits.

`chats.newMessageMode` ([spec 2](config.md#section-6-6)) decides what a message does while a turn
runs:

- **`merge`** (the default): the message joins the running turn at its next merge point, while the
  turn is not committed. The merge points are:
  1. before each call of an ordered batch except the first: the calls not started yet get the
     result "not run: a new message came in", and the batch ends there;
  2. after a batch, before the next model call;
  3. when a model response has no tool call and would end the turn: the turn makes one more model
     call with the message.

  A batch that runs in parallel is never cut; its merge point comes after it. A message that
  arrives in a committed turn waits, and starts a new turn after it. A message with images never
  joins: it waits for the next turn ([decision 0227](../DECISIONS.md#d0227)).

- **`after`**: the message waits for the running turn to end and starts the next one.

When a turn ends, the next one takes every waiting message, oldest first, up to 20 and through
the first that holds images; the rest wait for the turn after. No message is ever sent into a model response while it streams, and no tool
runs before the response that called it has ended.

The runtime holds at most 200 waiting messages per agent, and stops taking from the agent inbox
while it is full.

<a id="section-4"></a>

## 4. The turn

<a id="section-4-1"></a>

### 4.1 States

| State       | Meaning                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| `starting`  | The runtime asked the engine to start it (`turn/start`) and builds its context     |
| `streaming` | A model call runs                                                                  |
| `tools`     | A tool batch runs; no propose call has started                                     |
| `committed` | A propose call's body started; the batch finishes, and no model call follows       |
| `ending`    | The final text, the status line and `turn/end` are being written                   |
| `ended`     | Terminal, with an outcome: `ok`, `stopped`, `failed`, `budget` or `loop`           |
| `refused`   | Terminal: the engine refused to start it; its messages stay or are skipped by kind |

<a id="section-4-2"></a>

### 4.2 Transitions

| From                                            | To          | Trigger                                                                                      | Guard or effect                                                              |
| ----------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| (none)                                          | `starting`  | A message that starts a turn waits, and no turn runs for the agent                           | Fewer than 4 turns run in the install                                        |
| `starting`                                      | `refused`   | `turn/start` fails `agent.budget`, `agent.frozen`, `agent.archived` or `agent.not_found`     | Section 8.3 says what waits                                                  |
| `starting`                                      | `streaming` | The engine started the turn; the context is built (section 7)                                | Compaction runs here when needed                                             |
| `streaming`                                     | `streaming` | A failure that section 8.2 retries or falls back; or merge point 3                           | Within the attempts of section 8.2 and the limits of section 9               |
| `streaming`                                     | `tools`     | The response holds tool calls                                                                | The calls are validated first (section 5.2)                                  |
| `streaming`                                     | `ending`    | The response has no tool call and no message waits to merge; or a failure with no next step  | Outcome `ok`, or `failed`                                                    |
| `tools`                                         | `committed` | A propose call's body starts                                                                 | The committed mark is stored first (section 6.1)                             |
| `tools`                                         | `streaming` | The batch ended                                                                              | Budget left, under the call caps, no loop found, no `ask_owner` in the batch |
| `tools`                                         | `ending`    | The batch ended, and `ask_owner` ran, the budget is spent, a cap was reached or a loop found | Outcome `ok`, `budget` or `loop` (section 9)                                 |
| `committed`                                     | `ending`    | The batch ended                                                                              | Outcome `ok`                                                                 |
| `starting`, `streaming`, `tools` or `committed` | `ending`    | `inbox/stop`, `inbox/clear`, the turn's 10 minutes, the runtime's `stop`                     | Outcome `stopped`, or `failed` for the time limit (section 4.4)              |
| `ending`                                        | `ended`     | `turn/end` answered                                                                          | The engine's running turn for the agent clears                               |

<a id="section-4-3"></a>

### 4.3 The turn with the engine

The operations are in [spec 1, section 7.7](protocol.md#section-7-7).

1. `turn/start` `{ agent, session, turn, messages, outsideContent }`: the runtime names the
   messages the turn takes and whether its context already holds outside content (section 5.4).
   The engine checks the budget and the agent, records the agent's running turn in memory, pushes
   `chat/turnStarted`, and answers `budgetLeftMicros`.
2. `turn/mark` `{ agent, turn }`: the turn now holds outside content. The mark never clears. The
   runtime waits for the answer before its next model call.
3. `turn/say`, `turn/status`: the agent's text, edited in place until `final`, and its status
   line, onto the `chat:<agt>` topic.
4. `usage/record` after each model call (section 8.3).
5. `turn/end` `{ agent, turn, outcome }`: the engine clears the running turn and pushes
   `chat/turnEnded`. The runtime's exit clears every running turn as `failed`.

**The mark in the engine.** A proposal from the agent runtime takes the mark of its agent's
running turn: `intent/propose`, `order/create`, `alert/create` and `schedule/create` called with the
token the engine made at the runtime's current start. With no running turn, or with any other
token holding `agent`, the call counts as outside content, so no client can clear the mark. The
engine also marks an agent's running turn when a `chat/post` with images arrives for it, since the
message may join it. The mark is stored with the intent (`intents.outside_content`), the order, the
alert and the schedule, so the card warns ([rule 13](../ARCHITECTURE.md#rule-13)), the auto test
refuses it ([spec 6, section 5](intent-states.md#section-5)), and a wake-up from that alert or
schedule starts its turn marked.

<a id="section-4-4"></a>

### 4.4 Ending a turn

- **The final text** is the text of the turn's last model response, sent with `turn/say` and
  `final: true`. A committed turn's final text is the text of the response that proposed; the card
  speaks for the proposal. The model's reasoning stays in the transcript and never reaches a
  surface.
- **Stop.** `inbox/stop` aborts the running model call and every tool call that can stop. A propose
  call already sent finishes, up to 5 seconds. Calls not started get "not run: the owner stopped
  the agent". The turn ends `stopped`, and the messages that waited before the stop are dropped.
  Stopping never cancels an intent: the owner cancels a proposal on its card. A stopped turn whose
  proposal the engine took says its card is still open ([decision 0173](../DECISIONS.md#d0173)).
- **Freeze.** A freeze of the agent or the install sends `inbox/stop` with `reason: freeze`. While
  frozen, owner messages and settle messages still start turns, and proposals end
  `rejected_policy` with `frozen`. `turn/start` refuses a turn that only a schedule or an alert
  starts with `agent.frozen`, and the runtime skips those messages.
- **Time limit.** A turn ends 10 minutes after `turn/start`, as a stop does, with outcome `failed`.
- **Status lines.** A turn that ends `stopped`, `failed`, `budget` or `loop` tells the owner why in
  one status line, and so does a committed turn: its proposal waits for the owner, and more may
  follow (section 12).

<a id="section-5"></a>

## 5. Tools

<a id="section-5-1"></a>

### 5.1 Kinds

Each tool has one kind, which the loop reads; nothing else in the loop depends on a tool's name.

| Kind      | What it does                                                         | How it runs                                 | Commits the turn |
| --------- | -------------------------------------------------------------------- | ------------------------------------------- | ---------------- |
| `read`    | Reads; changes nothing outside the runtime                           | In parallel with other reads that allow it  | No               |
| `propose` | Creates an intent or an auto order in the engine, which opens a card | Alone, in order; one per turn (section 6.2) | Yes              |
| `control` | Changes something without moving money or opening a card             | In order                                    | No               |

| Kind      | Tools ([ARCHITECTURE.md section 6](../ARCHITECTURE.md#section-6))                                                                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`    | `token_search`, `portfolio`, `token_info`, `token_risk`, `quote`, `market_scan`, `chart`, `wallet_activity`, `lending_markets`, `lending_position`, `staking_options`, `bridge_quote`, `tx_status`, `orders`, `schedule_list`, `cex_*`, `search_web`, `search_x`, `read_page`, `notes_search`, `open_skill` |
| `propose` | `swap`, `buy`, `sell`, `send`, `approval_revoke`, `order_create`, `lend`, `stake`, `unstake`, `claim`, `bridge`, `cex_order`, `token_launch`                                                                                                                                                                |
| `control` | `order_cancel` (braking), `alert_create`, `schedule_create`, `schedule_cancel`, `notes_write`, `ask_owner`, `workspace_write`, `first_chat_end` ([decision 0242](../DECISIONS.md#d0242))                                                                                                                    |

<a id="section-5-2"></a>

### 5.2 Declaring and checking a call

- A tool declares its name, kind, description, a zod schema for its arguments, whether its results
  are outside content (section 5.4), and, for a read, whether it may run in parallel. The model sees
  `z.toJSONSchema(schema)`.
- Arguments are parsed with a JSON parser that keeps integers above 2^53 as their exact decimal
  strings, then checked with `safeParse` and no coercion. Money is a decimal string of base units,
  parsed to `bigint`.
- A call that fails the check, or names no known tool, does not run: its result is the error with
  the schema's issues, so the model can correct it. A refused call never commits the turn.
- The runtime fills the agent and the wallet; the model gives the terms and its reason, shown on the
  card as "agent says". A wallet outside the agent's own is refused
  ([decision 0176](../DECISIONS.md#d0176)).
- A result is text for the model, cut to 12,000 characters with a line saying how much was cut.
  A tool's error is a result too, never a turn failure.
- A read or control call times out after 60 seconds and returns its timeout as its result. A
  propose call waits up to 30 seconds for the engine; without an answer its outcome is unknown, and
  it is never sent again (section 6.1).

<a id="section-5-3"></a>

### 5.3 Tool batches

- A batch whose calls are all reads that allow parallel runs runs them together. Any other batch
  runs its calls one at a time, in the order the model gave them. A batch with a propose call is
  always ordered.
- Each call is written to the transcript before it runs, and its result after. A call that never
  ran still gets a result, so the transcript stays valid for every provider: "not run" with the
  reason (a merge, a stop, a cap, a held-back proposal, a restart).
- An abort lets a running call finish or stop as it can, and gives every call not started its "not
  run" result. A turn abort never reaches an intent.

<a id="section-5-4"></a>

### 5.4 Outside content

- **What is outside content:** text a third party controls. Web pages and search results, X
  posts, images, launch data, a note labelled `untrusted`, the text of an installed third-party
  skill, and the name, symbol or description of a token the registry does not list.
- **Which results hold it:** `search_web`, `search_x`, `read_page`, `market_scan` and `token_info`
  for an unlisted token always do; `notes_search` does when it returns an `untrusted` note, and
  `open_skill` when it reads an installed skill. Every
  other tool shows an unlisted token by its address and the words "unlisted token", so its result
  stays clean.
- **The turn's mark** is set when the model's context holds outside content: at `turn/start`, when
  any event in the kept history or the summary is marked, or a message the turn takes has images or
  carries `outsideContent`; during the turn, when a tool result or a joining message is outside
  content. Each such transcript event is stored with `outside` set, and a summary made from a
  marked event is marked.
- So the mark lasts as long as the session holds the content: until the owner clears the session
  (`/clear`). A turn that never saw outside content in its context proposes without the mark.
- A note written in a marked turn is stored `untrusted`, the label the engine sets, and no propose
  tool takes an address that only a note holds ([rule 10](../ARCHITECTURE.md#rule-10),
  [decision 0206](../DECISIONS.md#d0206)).

<a id="section-6"></a>

## 6. The committed turn and the proposal rule

<a id="section-6-1"></a>

### 6.1 The committed turn

- When a propose call's body starts, the runtime writes the call and the turn's committed mark in
  one `agent.sqlite` transaction, with the idempotency key it will send, and only then calls the
  engine. The mark only ever goes from unset to set.
- The call returns the intent or order id and the words "waiting for the owner's confirmation". It
  never waits for the tap.
- The batch finishes, and the turn ends. No model call follows, so no retry and no model fallback
  can follow either ([ARCHITECTURE.md section 16](../ARCHITECTURE.md#section-16)).
- A message that waits or arrives meanwhile starts a new turn, which is not committed.
- When the engine does not answer the propose call, its outcome is unknown: the result says so, the
  turn ends `failed`, and the call is never sent again.

<a id="section-6-2"></a>

### 6.2 One proposal per turn

[Decision 0167](../DECISIONS.md#d0167):

- In the response that commits a turn, the first propose call runs. Every later propose call gets
  the result "not run: one proposal at a time; propose it again after the owner answers this one".
- Every read and control call of that response runs, in order, before and after the proposal.
- The runtime stores the number of held-back calls with the turn (`turns.held_back`), and the owner
  sees one status line: the agent has more to propose and will after this card.
- The engine does not change: it accepts proposals from MCP clients and the owner as before.

<a id="section-6-3"></a>

### 6.3 After a proposal

The settle message (section 3.3) starts the next turn, with the intent's or the order's view. The
agent reports what happened and, when the owner's request held more, proposes the next step from
fresh state: a stop-loss only after its buy filled, the second token's buy after the first's card
was answered.

<a id="section-6-4"></a>

### 6.4 Asking the owner

`ask_owner` is a control tool. It sends the question and its choices with `turn/ask` (spec 1 gains
it with the question buttons) and returns "asked; the answer comes as the owner's next message".
The turn ends after its batch with outcome `ok`, without another model call. The answer arrives as
`inbox/message` with `answer`, and starts the next turn once. A typed message in place of a button
is the answer too. A proposal wins over a question: in a batch with a propose call that passed its
check, every `ask_owner` call gets "not run: the card already asks the owner"
([decision 0173](../DECISIONS.md#d0173)).

<a id="section-7"></a>

## 7. Context

<a id="section-7-1"></a>

### 7.1 Layout

The context of a model call is data with three parts, never one string with a marker:

1. **The stable prefix**, the same bytes from call to call while nothing in it changes:
   1. binference's instructions for the agent, fixed per version, with the owner's language;
   2. the workspace files in this order: `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`,
      `NOTES.md`, and `FIRST-CHAT.md` while it exists and the agent is in paper mode
      ([decision 0242](../DECISIONS.md#d0242));
   3. the skills index: each installed skill's name, description and location, by name, read
      from the engine with `skill/list` ([decision 0207](../DECISIONS.md#d0207));
   4. the tool declarations, by name.
2. **The history**: the session's latest summary, then every transcript event after it, in order.
3. **The volatile tail**: one context message after the history, built for each model call and
   never stored: the time in the owner's timezone, paper or live, frozen or not, the approval mode,
   the wallets and their USD balances, open orders, today's spend against the limits, the model
   budget left, and the send level. The runtime reads these from the engine at `turn/start` and
   again after a batch that called the engine to write.

A workspace file edited between turns applies at the next turn's first call. Each transport marks
the end of the prefix and the end of the history for providers that take explicit cache marks;
nothing after the history carries one.

<a id="section-7-2"></a>

### 7.2 Sizes

| Part                  | Most                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| One workspace file    | 12,000 characters; a longer one is cut with a line saying so, and `binference check` names it |
| All workspace files   | 40,000 characters                                                                             |
| The skills index      | 100 skills, then a line with the number left out                                              |
| One tool result       | 12,000 characters (section 5.2); `read_page` reads at most 2 MiB of a page                    |
| Images in one message | 4, each at most 5 MiB ([spec 1, section 7.7](protocol.md#section-7-7))                        |

<a id="section-7-3"></a>

### 7.3 Compaction

- **When.** Before a model call, when the estimated input with the output reserve passes 80% of the
  model's context window; and after a model call fails with the `context` class (section 8.2), after
  which the call is made once more. A committed turn makes no model call, so it never compacts.
- **What is kept.** The newest history up to 40% of the window, starting at a turn's start where it
  can, and always the running turn's own events. A cut never falls between a tool call and its
  result.
- **The summary.** The `fast` model summarizes the compacted range with the previous summary, in
  the session's language, in at most 16,000 characters. It keeps the owner's open questions, the
  intents and orders and their states, and what the owner asked the agent to remember.
- **The identifier rule.** Every intent id, order id, alert and schedule id, transaction hash and
  address in the compacted range must appear in the summary or stay in the kept range: ids and
  hashes exactly, addresses in any letter case. When one is missing, the runtime asks the `fast`
  model once more, naming what is missing. When one is still missing, nothing is written and the
  history stays whole; if the call still cannot fit, the turn ends `failed` and its status line
  asks the owner to clear the session.
- **Storage.** The summary is a `summary` event that names the range it covers, marked `outside`
  when any event of the range was. The transcript keeps every event for `chats.keepDays`;
  compaction only changes what the model sees.
- **Estimates.** A Han ideograph counts as 1.15 tokens and any other CJK character as one; other
  text counts one token per 4 characters, or one per number, word or symbol run when those are
  more ([decision 0203](../DECISIONS.md#d0203)); an image counts as 1,500 tokens. After each call, the provider's input count replaces the estimate
  for what that call held.
- **Cost.** The `fast` model's calls are recorded on the turn (section 8.3) and count against the
  budget.
- **Defaults.** The window, the summary model when no `fast` model is set, how the summary reaches
  the model and what the identifier rule reads follow [decision 0202](../DECISIONS.md#d0202).

<a id="section-8"></a>

## 8. Models and spend

<a id="section-8-1"></a>

### 8.1 Model calls

- Two transports: Chat Completions on the official `openai` client, for the `binference` and
  `openai` provider kinds, and Messages on the official `@anthropic-ai/sdk` client, for the
  `anthropic` kind ([spec 2, section 6.3](config.md#section-6-3)).
- Clients are built only in `runtime/src/providers/`, with every option set: the key and base URL
  from `settings`, no organization or project, retries 0, logging off, a timeout, and the runtime's
  own `fetch` with allowlisted headers ([ENGINEERING.md section 17](../ENGINEERING.md#section-17)).
- Each transport reduces its client's stream into one event list: text, reasoning, tool call start,
  delta and end, done, and error. A failure ends the stream as a classified error event; nothing
  throws.
- Each call asks for at most 4,096 output tokens, because the gateway reserves them.
- A call with no event for `models.idleTimeoutMs` (120 seconds) is aborted.
- Images go to `main` when it reads images; otherwise `models.vision` describes them, and `main`
  gets the description, which is outside content. A model reads images when `models.imageInput`
  names it, or when it is the vision model; never by its name
  ([decision 0227](../DECISIONS.md#d0227)). A turn reads its messages' images with
  `inbox/readImage` and checks them (section 7.2) before its first model call; a refusal ends the
  turn `failed` with a `turn.image.*` status line, and with no model that reads images and no
  vision model the line is `turn.image.noVision`. Each image goes before the text of its message.
  The bytes live in the runtime's memory for the turn that takes them; the transcript keeps the
  number of images and each description, never the bytes.
- A model the owner picked for the agent (`/ai`, `model/set`) is never swapped for another.
- The model check (`checkModel`, [decision 0221](../DECISIONS.md#d0221)) builds the same clients
  for one small call that `binference init` and `binference check` make in the CLI's process: it
  proves a key, its credit, its model and its address, and names what went wrong. The image check
  (`checkModelImages`, [decision 0228](../DECISIONS.md#d0228)) makes the same call with one 1x1
  PNG in the API's own image format; init lists a model that passes in `models.imageInput`.

<a id="section-8-2"></a>

### 8.2 Failure classes

| Class       | What it covers                                                              | Same model again                                                                         | Next model of the role                                         |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `transient` | 429, 500, 502, 503, 504, overloaded, a dropped connection, the idle timeout | Up to 2 times, after `Retry-After` or `Retry-After-Ms` (at most 60 s), else 1 s then 4 s | Yes, after the retries; the provider rests `models.cooldownMs` |
| `context`   | The request is over the model's context window                              | Once, after compaction                                                                   | No                                                             |
| `auth`      | 401, 403, a key the provider refuses                                        | No                                                                                       | Yes; `binference check` names the key                          |
| `billing`   | 402, the gateway key's spending limit                                       | No                                                                                       | Yes                                                            |
| `request`   | 400, 404 (no such model), 422, a tool declaration the provider refuses      | No                                                                                       | Yes                                                            |
| `refused`   | The provider stopped for its own safety rules                               | No                                                                                       | No; the turn ends with what the model wrote                    |
| `aborted`   | A stop, a clear, a freeze, the time limit, the runtime's `stop`             | No                                                                                       | No                                                             |

- Retries and fallbacks happen only in a turn that is not committed. An owner's picked model never
  falls back. A fallback lasts for the turn; the next turn starts again with the role's first model.
- One model call makes at most 4 attempts in all. Each attempt's usage is recorded.
- A retry or fallback sends the stored transcript again; a finished tool never runs twice.
- A failure with no next step ends the turn `failed`, and its status line names the class.

<a id="section-8-3"></a>

### 8.3 The budget

The engine holds each agent's daily model budget ([ARCHITECTURE.md section 26](../ARCHITECTURE.md#section-26)).

- **The day.** The budget runs from midnight to midnight in `owner.timezone`, 23 or 25 hours across
  a change of the clocks ([decision 0198](../DECISIONS.md#d0198)).
- **At the start.** `turn/start` fails `agent.budget` when nothing is left of today's budget, with
  `details.resumesAt`, the owner's next midnight. The engine sends `notice.budget` once that day,
  and the runtime sends the paused status line, `turn.budget` with `{ when }`, the resume time.
  Owner messages, settle messages and the resume report wait, and the runtime starts their turn at
  `resumesAt`; each owner message that comes meanwhile tries a start and gets the line again.
  Scheduled and alert turns are skipped: the runtime drops their messages with the reason `budget`.
- **After each call.** `usage/record` `{ agent, turn, model, inputTokens, outputTokens,
cachedTokens, usdMicros }` is sent after each attempt of a model call of every role, answered or
  failed, before the runtime acts on it or tries again, under the key `<turn>.usage.<n>` (`n`
  counts the turn's attempts from 1), and answers `budgetLeftMicros`, with `resumesAt` once it is 0.
  The engine charges an attempt once by its key, whatever token sends it again. The cost is the
  provider's own when it reports one (the gateway's `usage.cost`), else `models.prices`, else the
  built-in table, else 0, and `binference check` names a configured model with no price
  (`models.priced`). A price charges the cached price for tokens read from the cache, 1.25 times
  the input price for tokens written to it, and the input price for the rest, rounded up to the
  micro-dollar; a model with a long-prompt price charges it once the whole input passes its
  threshold. A failed attempt counts what its provider reported before it failed, else nothing
  ([decision 0191](../DECISIONS.md#d0191)).
- **Spent mid-turn.** When `budgetLeftMicros` is 0 or below, the batch of that response still runs,
  and no model call follows. The turn ends `budget` with the paused status line, or `ok` if it
  committed. The engine sends `notice.budget`, once that day.
- **No record, no call.** When `usage/record` fails, the turn makes no further model call and ends
  `failed`.

Orders, watchers and alerts never wait for the budget: they are code.

<a id="section-9"></a>

## 9. Limits and the loop guard

| Limit                                | Value                                                                          | When reached                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Tool calls in a turn                 | 25 (`models.maxToolCallsPerTurn`)                                              | Calls past the 25th get "not run: the turn reached its tool call limit"; the turn ends after the batch, `loop` |
| The loop guard                       | The same tool, arguments and result 3 times in a turn (`models.loopDetection`) | The turn ends after the batch, `loop`, and the owner gets `notice.loop`                                        |
| Model calls in a turn                | 40, compaction's included                                                      | The turn ends, `loop`                                                                                          |
| Turn time                            | 10 minutes from `turn/start`                                                   | The turn ends as a stop does, `failed`                                                                         |
| Turns running                        | 1 per agent, 4 in the install                                                  | The next turn waits                                                                                            |
| Messages one turn takes              | 20                                                                             | The rest wait for the next turn                                                                                |
| Untaken messages per agent (engine)  | 200                                                                            | `chat/post` fails `protocol.busy`                                                                              |
| Waiting messages per agent (runtime) | 200                                                                            | The runtime stops taking                                                                                       |
| Routed operations at once            | 8, then 64 waiting in the engine                                               | `protocol.busy`                                                                                                |

The loop guard compares a call's tool name, the SHA-256 of its arguments as JSON with sorted keys,
and the SHA-256 of its result. Three equal triples anywhere in one turn trip it; the third call's
result is still stored. It counts the calls that ran, and its status line wins over the tool call
limit's in the same batch. The engine sends `notice.loop` when the runtime sends the loop guard's
status line (`turn.loop`) ([decision 0191](../DECISIONS.md#d0191)).

<a id="section-10"></a>

## 10. Routed operations

`chat/messages`, `notes/search`, `notes/list`, `notes/write` and `notes/delete` (marked R in
[spec 1, section 7](protocol.md#section-7)) read and write what only `agent.sqlite` holds.

1. The engine checks the caller's scopes, as for any operation.
2. It sends a `route` line with the operation, its parsed args and the origin it sets from the
   caller: `owner` for a client with `confirm` or `admin`; `agent` for the runtime, in a turn of
   the agent the call names whose context holds no outside content; `untrusted` for any other
   caller; `system` for the engine itself ([decision 0206](../DECISIONS.md#d0206)).
3. The runtime answers with `routeReply` within 10 seconds, or the call fails `engine.timeout`.
   While the runtime is down it fails `runtime.unavailable`.

A routed write is idempotent like any other: the engine stores its key and result as for its own
operations.

<a id="section-11"></a>

## 11. What the runtime stores, and when

`agent.sqlite` holds `meta` (with the writer fence), `sessions`, `turns`, `chat_queue`,
`transcript_events`, `notes` and `notes_fts` ([spec 3, section 3](database.md#section-3)). Every
write checks the fence in its transaction. The order of writes is part of this spec:

1. A message is written to `chat_queue` before `inbox/take`.
2. A turn's row is written once `turn/start` answers, with the messages it took.
3. A tool call is written before it runs; a propose call with the committed mark, before the engine
   call.
4. A tool result is written when it returns, before the next call starts.
5. `usage/record` is answered before the runtime acts on the model's response.
6. The final text event is written before `turn/say` with `final: true`, and `turn/end` comes last.

The transcript is append-only: an update or delete of an event fails. Prompts and tool results
never reach the logs, which carry ids, counts, classes and times only.

<a id="section-12"></a>

## 12. Changes to the other specs

Made with this spec:

- **Spec 1.** `turn/start`, `turn/mark`, `inbox/list` and `inbox/take`; the push kinds
  `inbox/orderSettled`, `inbox/stop` and `inbox/clear`; the data of every `inbox` push (section
  3.3); what `chat/post`'s `turn` names; the error `agent.budget`; the id prefix `msg_`; how the
  engine reads the turn's mark (section 4.3).
- **Spec 3.** `agent_inbox` and `agents.chat_session_id` in the engine database; `outside_content`
  on `orders`, `alerts` and `schedules`; `chat_queue`, `turns.held_back` and
  `transcript_events.outside` in the agent database.
- **Spec 6, section 5.** The runtime the engine starts is a child process; the sentence on who may
  say a turn read no outside content names its token.

Made later, accepted by the owner on 2026-10-12:

- **Spec 1.** `turn/ask` and `chat/answer` with the question buttons
  ([section 7.7](protocol.md#section-7-7)), and `inbox/alertFired` with alert wake-ups
  ([section 8.4](protocol.md#section-8-4)).
- **Spec 3.** `questions` and `question_messages`
  ([section 2.7](database.md#section-2-7)).
- **Spec 4.** The chat status lines this spec uses, in both languages, for every way a turn ends
  ([section 8.1](cards-and-messages.md#section-8-1)); the agent's questions
  ([section 8.2](cards-and-messages.md#section-8-2)); and the first chat
  ([section 8.3](cards-and-messages.md#section-8-3)).

<a id="section-13"></a>

## 13. Invariants

Property and scripted-model tests hold these for every generated run:

1. No turn sends two proposals to the engine.
2. A committed turn makes no model call after its batch.
3. Every tool call in a stored transcript has exactly one result, after any abort or crash.
4. No proposal is sent twice, across restarts.
5. A proposal from a turn whose context held outside content carries the mark.
6. No model call starts before the previous call's usage was recorded.
7. No turn runs more than 25 tool calls or 40 model calls.
8. Every message the engine stored is taken into exactly one chat queue position, or dropped with a
   reason.
9. Compaction never removes an identifier from what the model sees.
10. A message that joins a turn never sits between a tool call and its result.

<a id="section-14"></a>

## 14. Security checklist for this spec

- The runtime holds no key and no `confirm` scope; its token is new at each start, lives only in
  memory, and the engine keeps only its hash.
- It sees no environment variable and reads no config file, engine database, key or token file.
- Only the runtime the engine started can say a turn read no outside content; every other path is
  marked.
- Cards come from the stored intent, never from model text; propose arguments are typed, checked
  without coercion, and carry money as decimal strings.
- The runtime fills the agent and the wallet; the model never picks them.
- A deployer's token name reaches the model only through a tool that marks the turn.
- No proposal is retried, after a failure or a restart.
- Prompts and tool results never reach a log.
