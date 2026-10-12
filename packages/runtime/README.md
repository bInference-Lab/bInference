# @binference/runtime

## Purpose

The agent runtime (spec 8): the process the engine starts, one per install, to run each agent's
model loop, sessions and tools. It is a client of the engine with the scopes `read`, `propose` and
`agent`, and holds no key.

## API

| Export                                     | What it does                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `EngineLine`, `engineLineSchema`           | The lines the engine writes: `start`, `settings`, `route`, `stop`                                    |
| `RuntimeLine`, `runtimeLineSchema`         | The lines the runtime writes: `ready`, `routeReply`, `health`                                        |
| `RuntimeSettings`, `runtimeSettingsSchema` | The models with their keys, the chat mode, search and the owner                                      |
| `isRoutedOperation`                        | Whether the runtime answers an operation through the engine                                          |
| `readControlLines`                         | Cuts a pipe's bytes into lines, refusing one over `maxControlLineBytes`                              |
| `runtimeNodeArguments`                     | The Node arguments that start the runtime under the permission model                                 |
| `@binference/runtime/process`              | The built runtime process, `dist/runtime-process.mjs`; never imported                                |
| `@binference/runtime/testing`              | The runtime run in the test's process, a start line to send it, a scripted model and a turn recorder |

## The runtime process

The engine starts `process.execPath` with `runtimeNodeArguments(entry)`, an empty environment and
pipes for standard input and output, which only the engine holds.

1. The engine writes `start`: the token it made for this start alone, its IPC address, the paths
   of `agent.sqlite` and the workspace, and the settings.
2. The runtime signs in to the engine with the token, then writes `ready`, and its `health` every
   10 seconds.
3. The engine writes `route` for a routed operation (`chat/messages`, `notes/*`); the runtime
   answers `routeReply` with the same id.
4. On `stop`, or when its input ends, the runtime closes its connection and exits with code 0. A
   first line that is not `start`, a line it cannot read, or a refused sign-in ends it with code 1.

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
