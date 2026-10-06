# @binference/client

## Purpose

The typed client of the engine protocol, for Node and browsers. Every surface that talks to the
engine uses it: the agent runtime, the console and Mini App, the CLI and terminal chat, and the MCP
server. It is built over the protocol's operation table, so each call's args and result are typed
from `ArgsOf` and `ResultOf`. It signs in with `open`, encodes args and parses results with each
operation's schemas, reconnects with capped backoff and jitter, and sends the calls in flight again
on the new socket. It makes `subscribe` operations such as `log/follow` again on each new
connection, and keeps each push topic in `seq` order with one refetch after a gap. It takes its
socket, clock and randomness as options, so it uses no Node-only API.

## API

| Export                                                       | What it does                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `createProtocolClient`, `ProtocolClient`                     | The client: `connect`, `call`, `subscribe`, `status` and `close`                 |
| `ProtocolClientOptions`, `CallOptions`                       | What the client and each call take: the table, socket, credential, ports, limits |
| `CallableName`                                               | The operations `call` takes: all but `push/subscribe` and `push/unsubscribe`     |
| `TopicHandlers`                                              | A topic subscriber: `onPush` for each push, `refetch` to load state              |
| `ProtocolSocket`, `SocketFactory`                            | The part of the standard WebSocket the client uses                               |
| `SocketEvents`, `SocketOpen`, `SocketMessage`, `SocketClose` | The socket events the client listens to                                          |
| `DeviceProver`                                               | Signs the engine's challenge with a console device's key                         |
| `ClientLimits`, `defaultClientLimits`                        | Timeouts, the pending-call and topic bounds, the reconnect policy                |
| `ClientStatus`                                               | Idle, connecting, ready with the engine's `ready`, or closed                     |
| `clientErrorCodes`, `ClientErrorCode`                        | The error codes the client raises itself, for surfaces to translate              |

The operation types (`OperationTable`, `OperationShapes`, `OperationName`, `ArgsOf`, `ResultOf`)
come from `@binference/protocol`.

## Example

```ts
import { createProtocolClient } from "@binference/client";
import { operations } from "@binference/protocol";

const client = createProtocolClient({
  operations,
  openSocket: () => new WebSocket("ws://127.0.0.1:7456/ws"),
  client: { kind: "console", version },
  credential: { device: deviceId },
  proveDevice: signChallenge,
  clock,
  random,
  logger,
});
await client.connect(AbortSignal.timeout(10_000));

// Typed as ArgsOf<"intent/get"> in and ResultOf<"intent/get"> out.
const intent = await client.call("intent/get", { intent: intentId }, { signal });

client.subscribe("intent", {
  onPush: (push) => applyIntentChange(push),
  refetch: async (signal) => loadIntents(signal),
});
```
