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
   answers `routeReply` with the same id.
4. On `stop`, or when its input ends, the runtime ends each running turn as a stop does, keeping
   the waiting messages, closes its connection and `agent.sqlite`, and exits with code 0. A first
   line that is not `start`, a line it cannot read, an agent database it cannot open, or a refused
   sign-in ends it with code 1.

## Models

`src/providers/` holds the model transports (spec 8, section 8;
[decision 0175](../../docs/DECISIONS.md#d0175)). A turn calls the settings' main model,
`models.main` as `<provider>/<model>`. A provider of the `binference` or `openai` kind is called
through the official `openai` client's Chat Completions, built there and nowhere else
(`check:model-clients`): every option is set, so no `OPENAI_*` variable changes a call, it never
retries or logs, and its `fetch` sends only POST requests under the provider's base URL with
`accept`, `content-type` and the provider's key. Each answer streams into the loop's events and
ends with `done` or one classified failure, with the provider's cost when it reports one. A model of
Anthropic's through the gateway gets cache marks at the end of the stable prefix and of the history.
Until the Messages transport lands, the `anthropic` kind, like a missing model, ends each call as a
refused request, and the turn ends `failed` with `turn.failed.request`.

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

## Example

```ts
import { engineLineSchema } from "@binference/runtime";

const line = JSON.stringify(engineLineSchema.encode({ t: "stop" }));
```
