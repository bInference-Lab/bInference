# @binference/server

## Purpose

The engine's protocol server. It serves the frames of the engine protocol over one WebSocket per
client, at `/ws` on the HTTP listener and on each local IPC connection, and answers `GET /health`.
It signs each connection in, checks every call against the connection's scopes and transport, runs
each write once per idempotency key through the `IdempotencyStore`, and numbers the pushes of each
topic with their own `seq`. The engine and the agent runtime answer the operations through a typed
handler map; the server holds no domain logic. The spec is
[docs/specs/protocol.md](../../docs/specs/protocol.md).

- **Sign-in.** A client token signs in over IPC only, checked by the SHA-256 of its secret in the
  `AccessStore`. A console device signs in over WS only, by signing a fresh nonce and the page's
  origin with its paired key, stored as its SPKI DER in base64url as WebCrypto exports it. Every
  connection must reach `ready` within 10 seconds.
- **Local calls.** A call of an operation marked local, or of one whose args carry the owner key
  (an owner-key operation, such as `ceiling/set`), runs over IPC only, whatever the operation's row
  says; any other transport fails it with `auth.local_only`, so it needs a shell on the machine.
- **Loopback.** The HTTP listener binds a host beyond loopback only when `auth` is set; otherwise
  `start` refuses with `server.unsafe_bind` before anything binds. WS connections must come from
  `http://127.0.0.1:<port>`, `http://localhost:<port>` or an extra origin.
- **Bounds.** 1 MiB frames, 64 calls in flight and 20 calls a second with a burst of 60 per
  connection, 64 connections, a ping every 20 seconds, a 30-second call timeout and pushes kept for
  10 minutes or 1,000 per topic. `ServerLimits` names each one.
- **Secrets.** Tokens never reach a log; idempotency keys are kept by the credential's id.

## API

| Export                                                        | What it does                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `createProtocolServer`, `ProtocolServer`                      | The server: `start`, `acceptIpc`, `publish` and `close`        |
| `ProtocolServerOptions`, `HttpListenOptions`, `ServerAddress` | What the server is built from and where it listens             |
| `ServerAuth`                                                  | The `AccessStore` every sign-in is checked against             |
| `OperationHandlers`, `OperationHandler`, `HandlerCall`        | The typed handler map the engine and the runtime fill          |
| `Caller`, `Transport`                                         | Who makes a call, and over which transport                     |
| `EngineFacts`                                                 | The engine's release, state and owner settings, read when used |
| `PushEvent`                                                   | One event to push on a topic                                   |
| `ServerLimits`, `defaultServerLimits`                         | Frame, call, connection, ping and push bounds                  |
| `isLoopbackHost`                                              | Whether a host names this machine only                         |

Error codes the server raises itself start with `server.`: `server.unsafe_bind`,
`server.listen_failed`, `server.bad_push`, `server.too_many_topics` and `server.bad_result`, the
last one logged and answered as `internal.error`.

## Example

The composition root builds the server, binds the IPC endpoint to it and starts the listener:

```ts
import { createProtocolServer } from "@binference/server";

const server = createProtocolServer({
  http: { host: "127.0.0.1", port: config.engine.port, extraOrigins: config.engine.extraOrigins },
  auth: { access: stores.access },
  idempotency: stores.idempotency,
  handlers: {
    "safety/status": async ({ signal }) => ok(await safety.status(signal)),
    "intent/propose": async ({ args, caller, signal }) => intents.propose(args, caller, signal),
  },
  engine: { version, state: () => engineState, owner: () => owner },
  clock,
  random,
  logger: logger.child("server"),
});
await endpoint.bind({ signal, onSocket: (socket) => server.acceptIpc(socket) });
await server.start(AbortSignal.timeout(5_000));

server.publish({ topic: "intent", kind: "intent/changed", data: view });
```
