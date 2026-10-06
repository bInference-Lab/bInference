# @binference/client

The typed protocol client for Node and browsers. The spec is
[docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It runs in browsers: no `node:` import, no `process`, no `ws`. The socket comes from a
  `SocketFactory`, time and randomness from the `Clock` and `Random` ports.
- Frames, credentials and error codes come from `@binference/protocol`. This package parses with
  their schemas and writes no schema of its own.
- An `auth` or `protocol` code in `bye` is final; any other close may be retried.
- The client's own error codes live in `clientErrorCodes`; surfaces map each one to a message.
- Tests drive the client through `fake-engine.ts` and a manual clock; no test opens a socket.
