# @binference/server

## Purpose

The engine's protocol server. This part checks each call of a signed-in connection and routes it:
the operation must exist, the connection must hold its scope (or the scope of its scope case) and,
for a `local` operation, come in over IPC, and the engine must be ready. A write runs once per
idempotency key through the `IdempotencyStore`, and its result is stored before the reply. The
engine and the agent runtime answer the operations through a typed handler map; the server holds
no domain logic. It answers `push/subscribe`, `push/unsubscribe` and `engine/describe` itself and
numbers the pushes of each topic with their own `seq`. The spec is
[docs/specs/protocol.md](../../docs/specs/protocol.md).

## API

| Export                                                 | What it does                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `OperationHandlers`, `OperationHandler`, `HandlerCall` | The typed handler map the engine and the runtime fill          |
| `Caller`, `Transport`                                  | Who makes a call, and over which transport                     |
| `EngineFacts`                                          | The engine's release, state and owner settings, read when used |
| `PushEvent`                                            | One event to push on a topic                                   |

## Example

The engine fills the handler map; a handler returns its result or a protocol error code:

```ts
import { ok, err } from "@binference/core";
import type { OperationHandlers } from "@binference/server";

const handlers: OperationHandlers = {
  "safety/status": async ({ signal }) => ok(await safety.status(signal)),
  "intent/get": async ({ args, signal }) => {
    const intent = await intents.view(args.intent, signal);
    return intent === undefined ? err("intent.not_found") : ok(intent);
  },
};
```
