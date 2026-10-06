# @binference/client

## Purpose

The typed client of the engine protocol, for Node and browsers. It opens a signed-in connection to
the engine: it sends `open` with the client's credential, answers a console device's `challenge`
and checks the protocol version of the engine's `ready`. It takes its socket, clock and logger as
options, so it uses no Node-only API.

## API

| Export                                | What it does                                                        |
| ------------------------------------- | ------------------------------------------------------------------- |
| `ProtocolSocket`, `SocketFactory`     | The part of the standard WebSocket the client uses                  |
| `SocketEvents`, `SocketOpen`          | The socket events the client listens to                             |
| `SocketMessage`, `SocketClose`        | A text message, and the close code and reason                       |
| `DeviceProver`                        | Signs the engine's challenge with a console device's key            |
| `clientErrorCodes`, `ClientErrorCode` | The error codes the client raises itself, for surfaces to translate |

## Example

```ts
import type { DeviceProver, SocketFactory } from "@binference/client";
import { deviceProofText } from "@binference/protocol";

const openSocket: SocketFactory = () => new WebSocket("ws://127.0.0.1:7456/ws");
const proveDevice: DeviceProver = async (nonce, signal) =>
  signWithDeviceKey(deviceProofText({ nonce, origin: location.origin }), signal);
```
