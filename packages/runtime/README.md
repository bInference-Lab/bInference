# @binference/runtime

## Purpose

The agent runtime (spec 8): the process the engine starts, one per install, to run each agent's
model loop, sessions and tools. It is a client of the engine with the scopes `read`, `propose` and
`agent`, and holds no key.

## API

| Export                                     | What it does                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EngineLine`, `engineLineSchema`           | The lines the engine writes: `start`, `settings`, `route`, `stop`                                                                                           |
| `RuntimeLine`, `runtimeLineSchema`         | The lines the runtime writes: `ready`, `routeReply`, `health`                                                                                               |
| `RuntimeSettings`, `runtimeSettingsSchema` | The models with their keys, the chat mode, search and the owner                                                                                             |
| `isRoutedOperation`                        | Whether the runtime answers an operation through the engine                                                                                                 |
| `readControlLines`                         | Cuts a pipe's bytes into lines, refusing one over `maxControlLineBytes`                                                                                     |
| `runtimeNodeArguments`, `RuntimeFiles`     | The Node arguments that start the runtime under the permission model, granted its agent database                                                            |
| `@binference/runtime/process`              | The built runtime process, `dist/runtime-process.mjs`; never imported                                                                                       |
| `@binference/runtime/testing`              | The runtime run in the test's process, a start line to send it, a scripted model, a turn recorder, a stand-in model provider and the ports' contract suites |

## The runtime process

The engine starts `process.execPath` with `runtimeNodeArguments(entry, files)`, an empty
environment and pipes for standard input and output, which only the engine holds. Under Node's
permission model the built runtime may read its own program and the store worker bundled beside
it, `agent.worker.mjs`, read and write `agent.sqlite` and SQLite's files beside it, start the
store's worker threads and use the network; nothing else
([decision 0174](../../docs/DECISIONS.md#d0174)).

1. The engine writes `start`: the token it made for this start alone, its IPC address, the paths
   of `agent.sqlite` and the workspace, and the settings.
2. The runtime opens and migrates `agent.sqlite`, raises its writer fence and repairs every turn a
   crash left unfinished. It signs in to the engine with the token, sends each repaired turn's
   status line and end, starts the turns of the messages its chat queue still holds, reads every
   untaken message with `inbox/list`, watches the `inbox` topic, then writes `ready`, and its
   `health` every 10 seconds: its running turns and waiting messages.
3. The engine writes `route` for a routed operation (`chat/messages`, `notes/*`); the runtime
   answers `routeReply` with the same id: `chat/messages` as a page of the session's transcript,
   each event with its role, kind and text, and the engine names the agent's open session when
   the call names none.
4. On `stop`, or when its input ends, the runtime ends each running turn as a stop does, keeping
   the waiting messages, closes its connection and `agent.sqlite`, and exits with code 0. A first
   line that is not `start`, a line it cannot read, an agent database it cannot open, or a refused
   sign-in ends it with code 1.

## Context

Each model call sends three parts ([spec 8, section 7.1](../../docs/specs/runtime.md#section-7-1);
[decisions 0200](../../docs/DECISIONS.md#d0200) and [0201](../../docs/DECISIONS.md#d0201)),
built in `src/context/`:

1. **The stable prefix**, read once as a turn starts: binference's instructions, fixed per release
   and naming the owner's language, then each workspace file the agent has, read with
   `agent/readFile` in spec 8's order inside a delimiter that names it, each cut at 12,000
   characters and all at 40,000, then the skills index: each skill `skill/list` gives the agent,
   by name, with its location and description, at most 100, and never a skill's own text
   ([decision 0207](../../docs/DECISIONS.md#d0207)). Two turns with no workspace or skill change
   send the same bytes; an edit applies at the next turn.
2. **The history**: the session's latest summary, then every event after the range it covers.
3. **The volatile tail**: the live facts of `facts/get` and the model budget left, as the last user
   message after the history. They are read before the turn's first call and after a batch that
   ran a propose or control tool, never stored, and never marked for the cache. A read that fails
   says so, and the turn goes on.

### Compaction

Before a model call whose estimated input with its 4,096 output tokens passes 80% of the window,
and once after a `context` failure, `src/compaction/` replaces the oldest history with a summary
([spec 8, section 7.3](../../docs/specs/runtime.md#section-7-3);
[decision 0202](../../docs/DECISIONS.md#d0202)):

- **Estimates**: a CJK character is one token, other text one per 4 characters, plus 4 a message
  and 3 a call; after a call answers, the provider's input count replaces the estimate of what it
  sent. The window is 128,000 tokens, or the size of a call the provider refused as too long.
- **The cut** keeps the turn's own messages and the newest history up to 40% of the window, from a
  turn's start where one fits, never between a tool call and its result.
- **The summary** comes from `models.fast` (or `models.main` when no fast model is set) through the
  turn's retries, fallbacks and usage records, at most 16,000 characters, in the owner's language.
- **The identifier rule**: every intent, order, alert and schedule id, transaction hash and
  address of the compacted range and the summary before it must be in the new summary or in what
  stays. A second request names what is missing; if one is still missing, nothing is written.
- **Storage**: a `summary` event names the range it covers and is marked outside when the range
  was. It opens the history as a record on the owner's side that says it is not the owner's words.

## Models

`src/providers/` holds the model transports (spec 8, section 8;
[decisions 0175](../../docs/DECISIONS.md#d0175) and [0187](../../docs/DECISIONS.md#d0187)). A turn
calls the settings' main model, `models.main` as `<provider>/<model>`. A provider of the
`binference` or `openai` kind is called through the official `openai` client's Chat Completions,
and one of the `anthropic` kind through the official `@anthropic-ai/sdk` client's Messages, each
built there and nowhere else (`check:model-clients`): every option is set, so no `OPENAI_*` or
`ANTHROPIC_*` variable and no credential file changes a call, a client never retries or logs, and
its `fetch` sends only POST requests under the provider's base URL with `accept`, `content-type` and
the headers the transport sets itself: the provider's key, and Anthropic's API version. Each answer
streams into the loop's events and ends with `done` or one classified failure, with the provider's
cost when it reports one. Both transports mark the end of the stable prefix and of the history for
Anthropic's models, Messages on the last tool too. A Messages response that thought ends with a
replay of its blocks, which the loop keeps with the response and the next call sends back unchanged.
A missing model ends each call as a refused request, and the turn ends `failed` with
`turn.failed.request`.

A turn calls its role's chain (`modelChainFor`): `models.main`, then `models.fallbacks.main` in
order, or only a model the owner picked ([decision 0188](../../docs/DECISIONS.md#d0188)). A
`transient` failure waits as the provider asked, at most 60 s, else 1 s then 4 s, and tries the same
model twice more; then the provider rests for `models.cooldownMs` in every turn, and the next model
takes over. `auth`, `billing` and `request` take the next model at once; `context`, `refused`, a
stop and a committed turn end the call. One call makes at most 4 attempts, a fallback lasts for the
turn, and only the attempt that answered reaches the transcript. An attempt that goes
`models.idleTimeoutMs` without an event, from its start or between two events, is cut as a
`transient` failure.

The transports reach the network through the `StreamingHttp` port, which streams an answer's body
as it arrives; the runtime process binds it to undici with a pool of its own, which names binference
in the user agent and follows no redirect.

## The turn loop

`src/loop/` runs one turn of an agent's chat (spec 8, sections 4 to 6). `createChatTurn` asks the
engine to start the turn, calls the model, and runs each response's tool calls as one batch:
reads that allow it side by side, any other batch in the model's order. It stops when the model
answers with no call, a proposal commits the turn, a tool asks the owner a question, a limit is
reached, or the turn is stopped. Every call the loop does not run gets a "not run" result with its
reason, so each call in the transcript has exactly one result.

A turn sends at most one proposal ([decision 0167](../../docs/DECISIONS.md#d0167)): the first
propose call of a response commits the turn, and every later one gets "not run" and is counted with
the turn. A turn runs at most 25 tool calls; a call past the 25th does not run, and the turn ends
after its batch. When a tool result or a joining message holds outside content, the turn tells the
engine before any later call or model call, so its proposal carries the mark.

The loop bounds every wait itself: a tool call or a model stream that ignores its signal is
settled at its deadline or stop, and a proposal with no answer by then is never sent again. A
waiting message joins only where a model call can answer it; otherwise it starts the next turn. A
port that throws ends the turn `failed`, and the turn still writes its end
([decision 0172](../../docs/DECISIONS.md#d0172)).

The loop reaches the outside only through the ports in `src/loop/ports.ts`: the model transport,
the tool box, the turn's journal in `agent.sqlite`, the engine's side of the turn, and the chat
queue's merge source. Each has a contract suite in `src/contracts/`, which every binding and fake
runs. `@binference/runtime/testing` has the suites, a scripted transport and a recorder that stands
in for the journal, the engine and the queue.

## Sessions and the chat queue

`src/sessions/` keeps each session in `agent.sqlite` under the fence the runtime's start raised
(spec 8, sections 3 and 11): a turn's journal writes each response, call, result and joining
message before the loop goes on, and a proposal with its turn's committed mark in one write. At a
start, every turn a crash left unfinished is repaired before the runtime connects: each call with
no result gets one, a proposal "the outcome of this proposal is unknown after a restart; it was
not sent again", and the turn ends `failed`. Nothing is proposed again. The conversation a turn
sends the model is repaired as it loads, so each call has exactly one result after its response
([decision 0174](../../docs/DECISIONS.md#d0174)).

`src/chats/` is the chat queue. Each message of the engine's inbox is written into it before
`inbox/take`, once; a stop or a clear is applied at once. Each agent runs one turn at a time, at
most 4 in the install, taking its open session's waiting messages, oldest first and at most 20. In
`merge` mode (`chats.newMessageMode`) a message that arrives during a turn joins it at its next
merge point; in `after` mode, and after a committed batch, it starts the next turn.

`src/relay/` reaches the engine's side of chat through the `EngineChat` port, bound to the
protocol client: the `inbox` topic, `inbox/list`, `inbox/take` and the `turn/*` operations, with a
turn's status line sent as spec 4's keys.

## Tools

`src/tools/` declares the agent's tools. `defineTool` takes a name, a kind (`read`, `propose` or
`control`), a description and a zod schema of the arguments; the model sees the schema's JSON
Schema. A call's arguments are parsed keeping integers past 2^53 exact, then checked with
`safeParse` and no coercion, so money arrives as a decimal string of base units and becomes a
`bigint`. Arguments over 65,536 characters or nested deeper than 64 levels, a key written twice, and
an integer past 2^53 not written as plain digits are refused before they are read. A call that
fails a check never runs, and the model reads why.
`createToolBox` holds an agent's tools for its turns.

`agentTools` are the agent's first tools, each mapped onto one operation of the engine and called
over the runtime's connection: the reads `portfolio` (`portfolio/get`), `token_info` (`asset/get`),
`token_risk` (`risk/check`), `quote` (`quote/get`), `orders` (`order/list`) and `tx_status`
(`intent/get`); the proposals `swap`, `buy` and `sell` (`intent/propose`) and `order_create`
(`order/create`); and `order_cancel` (`order/cancel`), a control tool that brakes, so it runs in a
committed turn's batch too. The model writes the terms and its reason; the runtime names the turn's
agent and no wallet, so the engine acts from the agent's default wallet, and a call that names an
agent or a wallet fails its check ([decision 0176](../../docs/DECISIONS.md#d0176)). A tool reads and
cancels only its own agent's intents and orders, and shows a token the registry does not list as
"unlisted token", except in `token_info`, whose result is then outside content. A proposal sends
the call's key as its idempotency key and answers the intent's or order's id and that it waits for
the owner; a refusal the engine answered is an error result, and any other failure leaves the
outcome unknown, so it is never sent again. `open_skill` (`skill/read`) reads one file of a skill
the index lists, by the skill's name and a path inside its folder; the engine refuses any other,
and an installed skill's text is outside content. The market reads `market_scan` (`market/scan`),
`chart` (`market/chart`) and `wallet_activity` (`wallet/activity`) answer compact lines, and a
result with data in it is outside content
([decisions 0257 and 0258](../../docs/DECISIONS.md#d0257)). The built runtime gives every turn
these tools.

## Example

```ts
import { engineLineSchema } from "@binference/runtime";

const line = JSON.stringify(engineLineSchema.encode({ t: "stop" }));
```
