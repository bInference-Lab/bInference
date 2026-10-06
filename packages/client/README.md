# @binference/client

## Purpose

The typed client of the engine protocol, for Node and browsers. Every surface that talks to the
engine uses it: the agent runtime, the console and Mini App, the CLI and terminal chat, and the MCP
server. It signs in with `open`, sends typed calls and parses their results, reconnects with capped
backoff and jitter, sends the calls in flight again on the new socket, and keeps each push topic in
`seq` order with one refetch after a gap. It takes its socket, clock and randomness as options, so
it uses no Node-only API.

## API

| Export                                                              | What it does                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `createProtocolClient`, `ProtocolClient`                            | The client: `connect`, `call`, `subscribe`, `status` and `close`        |
| `ProtocolClientOptions`, `CallOptions`                              | What the client and each call take: socket, credential, ports, limits   |
| `OperationTable`, `OperationContract`                               | The operations a client calls, each with its args and result schemas    |
| `OperationName`, `OperationArgs`, `OperationResult`                 | The typed name, args and result of one operation in a table             |
| `SubscriptionOperations`, `KnownOperation`                          | The `push/subscribe` and `push/unsubscribe` contracts a table must hold |
| `SubscribeArgs`, `SubscribeResult`, `TopicStart`, `UnsubscribeArgs` | What the client sends and reads in those two operations                 |
| `TopicHandlers`                                                     | A topic subscriber: `onPush` for each push, `refetch` to load state     |
| `ProtocolSocket`, `SocketFactory`                                   | The part of the standard WebSocket the client uses                      |
| `SocketEvents`, `SocketOpen`, `SocketMessage`, `SocketClose`        | The socket events the client listens to                                 |
| `DeviceProver`                                                      | Signs the engine's challenge with a console device's key                |
| `ClientLimits`, `defaultClientLimits`                               | Timeouts, the pending-call and topic bounds, the reconnect policy       |
| `ClientStatus`                                                      | Idle, connecting, ready with the engine's `ready`, or closed            |
| `clientErrorCodes`, `ClientErrorCode`                               | The error codes the client raises itself, for surfaces to translate     |

## Example

```ts
import { createProtocolClient } from "@binference/client";

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

const intent = await client.call("intent/get", { intent: intentId }, { signal });

client.subscribe("intent", {
  onPush: (push) => applyIntentChange(push),
  refetch: async (signal) => loadIntents(signal),
});
```
