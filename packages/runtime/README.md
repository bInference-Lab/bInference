# @binference/runtime

## Purpose

The agent runtime (spec 8): the process the engine starts, one per install, to run each agent's
model loop, sessions and tools. It is a client of the engine with the scopes `read`, `propose` and
`agent`, and holds no key.

## API

| Export                                     | What it does                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `EngineLine`, `engineLineSchema`           | The lines the engine writes: `start`, `settings`, `route`, `stop`       |
| `RuntimeLine`, `runtimeLineSchema`         | The lines the runtime writes: `ready`, `routeReply`, `health`           |
| `RuntimeSettings`, `runtimeSettingsSchema` | The models with their keys, the chat mode, search and the owner         |
| `isRoutedOperation`                        | Whether the runtime answers an operation through the engine             |
| `readControlLines`                         | Cuts a pipe's bytes into lines, refusing one over `maxControlLineBytes` |
| `runtimeNodeArguments`                     | The Node arguments that start the runtime under the permission model    |
| `@binference/runtime/process`              | The built runtime process, `dist/runtime-process.mjs`; never imported   |
| `@binference/runtime/testing`              | The runtime run in the test's process, and a start line to send it      |

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

## Example

```ts
import { engineLineSchema } from "@binference/runtime";

const line = JSON.stringify(engineLineSchema.encode({ t: "stop" }));
```
