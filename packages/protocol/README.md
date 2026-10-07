# @binference/protocol

## Purpose

The protocol the engine serves to every client: the agent runtime, the console and Mini App, the
CLI and terminal chat, and the MCP server. It defines the frames that travel over the WebSocket,
the credentials a client signs in with, the id prefixes, the error codes, the version rules and
every operation with its scope, as zod schemas that also describe themselves as JSON Schema. A
typed client, the server and the MCP server are built from the one operation table.

## API

| Export                                              | What it does                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `decodeClientFrame`, `decodeEngineFrame`            | Parse one text message into a frame, or name the error code it earns      |
| `OpenFrame`, `openFrameSchema` and the other frames | One type and one schema for each of the nine frames                       |
| `credentialSchema`, `deviceProofText`               | What `open.auth` carries, and the text a console device signs             |
| `clientTokenSchema`                                 | A `bnt_` client token: what `auth/cli.token` and `auth/mcp.token` hold    |
| `scopes`, `scopeSchema`, `Scope`                    | What a client may do                                                      |
| `idPrefixes`, `protocolIdSchema`, `ProtocolId`      | The typed, prefixed UUIDv7 ids of every thing                             |
| `protocolErrorCodes`, `protocolErrorSchema`         | Every error code the engine sends, and the error a `fail` frame holds     |
| `protocolVersion`, `checkProtocolVersion`           | The current version, and the check that refuses an unserved one           |
| `describeProtocol`                                  | The protocol as JSON Schemas, for other languages and the compat check    |
| `operations`, `OperationName`, `ArgsOf`, `ResultOf` | Every operation as data: its scope, kind, key rule, transport and schemas |
| `parseCall`                                         | Checks a call: a known operation, a key on a write, args its schema takes |
| `describeOperations`                                | The answer of `engine/describe`, with the JSON Schemas of each operation  |
| `mcpTools`                                          | The tools of `binference mcp` and the operation each one calls            |
| `intentRequestSchema`, `IntentView` and the others  | The shared requests and views of every operation                          |

## Example

```ts
import { decodeClientFrame, operations, parseCall } from "@binference/protocol";

const decoded = decodeClientFrame(text);
if (!decoded.ok) {
  // "protocol.bad_frame" or "protocol.version": answer with a bye frame and close.
  return closeWith(decoded.error);
}
if (decoded.value.t === "open") {
  await signIn(decoded.value.auth);
}
if (decoded.value.t === "call") {
  // "protocol.unknown_op", "protocol.key_required" or "protocol.bad_args": answer with a fail.
  const call = parseCall(decoded.value);
  if (call.ok && call.value.op === "intent/propose") {
    // call.value.args is an IntentRequest; operations["intent/propose"].scope is "propose".
    await propose(call.value.args, operations[call.value.op].scope);
  }
}
```
