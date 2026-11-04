# @binference/client

**English** · [简体中文](README.zh.md)

A typed client for the binference engine protocol, for Node and browsers: calls, reconnects and
pushes. binference is an open-source AI agent that trades on BNB Smart Chain for its owner and
asks before every transaction. The console and the terminal chat reach the engine through this
client.

## Install

```sh
npm install @binference/client @binference/protocol
```

It needs Node 26.1 or later, or a browser with WebSocket.

## Use

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
const intent = await client.call("intent/get", { intent: intentId }, { signal });
```

Each call is typed by its operation. Calls wait across reconnects, and a gap in a topic's pushes
starts one refetch.

## Links

- Source and the protocol spec: <https://github.com/bInference-Lab/bInference>
- Website: <https://binference.io>

MIT license. Third-party notices are in `NOTICES.md`.
