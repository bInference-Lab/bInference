# @binference/protocol

## Purpose

The protocol the engine serves to every client: the agent runtime, the console and Mini App, the
CLI and terminal chat, and the MCP server. It defines the frames that travel over the WebSocket,
the credentials a client signs in with, the id prefixes, the error codes and the version rules, as
zod schemas that also describe themselves as JSON Schema.

## API

| Export                                              | What it does                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `decodeClientFrame`, `decodeEngineFrame`            | Parse one text message into a frame, or name the error code it earns  |
| `OpenFrame`, `openFrameSchema` and the other frames | One type and one schema for each of the nine frames                   |
| `credentialSchema`, `deviceProofText`               | What `open.auth` carries, and the text a console device signs         |
| `scopes`, `scopeSchema`, `Scope`                    | What a client may do                                                  |
| `idPrefixes`, `protocolIdSchema`, `ProtocolId`      | The typed, prefixed UUIDv7 ids of every thing                         |
| `protocolErrorCodes`, `protocolErrorSchema`         | Every error code the engine sends, and the error a `fail` frame holds |
| `protocolVersion`, `checkProtocolVersion`           | The current version, and the check that refuses an unserved one       |
| `describeProtocol`                                  | The protocol as JSON Schemas, for clients in other languages          |

## Example

```ts
import { decodeClientFrame } from "@binference/protocol";

const decoded = decodeClientFrame(text);
if (!decoded.ok) {
  // "protocol.bad_frame" or "protocol.version": answer with a bye frame and close.
  return closeWith(decoded.error);
}
if (decoded.value.t === "open") {
  await signIn(decoded.value.auth);
}
```
