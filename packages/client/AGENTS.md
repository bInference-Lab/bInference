# @binference/client

The typed protocol client for Node and browsers: calls and reconnect. The spec is
[docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It runs in browsers: no `node:` import, no `process`, no `ws`. The socket comes from a
  `SocketFactory`, time and randomness from the `Clock` and `Random` ports.
- Frames, credentials, error codes and the operation table come from `@binference/protocol`. This
  package parses with their schemas and writes no schema of its own.
- Every call takes an `AbortSignal` and a timeout. A call waits in the bounded pending map until
  its answer, across reconnects, and goes out again on each new connection with the same id and
  idempotency key. Closing the client rejects every waiting call.
- Reconnects go through `retry` from `@binference/core`. An `auth` or `protocol` code in `bye`
  ends the client; any other close reconnects.
- The client's own error codes live in `clientErrorCodes`; surfaces map each one to a message.
- Tests drive the client through `fake-engine.ts` and a manual clock; no test opens a socket.
