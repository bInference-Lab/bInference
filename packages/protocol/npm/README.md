# @binference/protocol

**English** · [简体中文](README.zh.md)

The binference engine protocol as zod schemas: frames, operations, credentials, ids, error codes
and versions. binference is an open-source AI agent that trades on BNB Smart Chain for its owner
and asks before every transaction. Its engine speaks this protocol to the console, Telegram, the
terminal and any other client.

## Install

```sh
npm install @binference/protocol
```

It needs Node 26.1 or later.

## Use

```ts
import { decodeClientFrame, operations, parseCall } from "@binference/protocol";

const decoded = decodeClientFrame(text);
if (decoded.ok && decoded.value.t === "call") {
  const call = parseCall(decoded.value);
  if (call.ok) {
    console.log(call.value.op, operations[call.value.op].scope);
  }
}
```

Every operation names its scope, and every error a dotted code. Inside one protocol version a
change only adds.

## Links

- Source and the protocol spec: <https://github.com/bInference-Lab/bInference>
- Website: <https://binference.io>

MIT license. Third-party notices are in `NOTICES.md`.
