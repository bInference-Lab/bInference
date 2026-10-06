# @binference/client

The typed protocol client for Node and browsers: calls, reconnect and pushes. The spec is
[docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It runs in browsers: no `node:` import, no `process`, no `ws`. The socket comes from a
  `SocketFactory`, time and randomness from the `Clock` and `Random` ports.
- Frames, credentials, error codes and the operation table come from `@binference/protocol`. This
  package declares no operation type and no schema of its own: calls are typed from the protocol's
  `OperationShapes` (`ArgsOf` in, `ResultOf` out), args are encoded and results parsed with each
  operation's schemas, and pushes go through the protocol's own `push/subscribe` and
  `push/unsubscribe`. A test may pass a smaller `OperationTable<Shapes>` of its own.
- Every call takes an `AbortSignal` and a timeout. A call waits in the bounded pending map until
  its answer, across reconnects, and goes out again on each new connection with the same id; an
  operation whose `idempotency` is `key` keeps its key. Closing the client rejects every waiting
  call.
- An operation of `kind` `subscribe` holds per-connection state: the last successful call of each
  one is made again on every new connection, in the order the calls were made.
- Reconnects go through `retry` from `@binference/core`. An `auth` or `protocol` code in `bye`
  ends the client; any other close reconnects.
- A gap in a topic's `seq` starts one refetch; pushes during it are covered by it.
- The client's own error codes live in `clientErrorCodes`; surfaces map each one to a message.
- Tests drive the client through `fake-engine.ts` and a manual clock; no test opens a socket.
