# @binference/server

The engine's protocol server: one WebSocket per client over HTTP and local IPC, with sign-in,
scopes, idempotent writes and pushes. The spec is
[docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is the transport, never the domain. Operations are answered by the handlers the composition
  root passes in (`OperationHandlers`); the server checks scopes, the transport, the engine's state
  and idempotency keys, and nothing else. A scope case reaches its handler, which decides it.
- Frames, credentials, error codes, scopes and the operation table come from
  `@binference/protocol`. A call fails only with a protocol error code; a code the server raises
  itself starts with `server.` and is a fault of the engine's own wiring.
- No connection is trusted for its address. Tokens sign in over IPC only, devices over WS only, and
  the HTTP listener binds beyond loopback only when `auth` is set.
- An owner-key operation (its args carry the owner key code, `takesOwnerKey`) runs over IPC only,
  even when its row allows any transport: `isLocalOnly` decides it in the call dispatch.
- Time and randomness come through the `Clock` and `Random` ports: the sign-in timeout, pings, call
  timeouts, the call rate and push retention all run on the clock, so tests drive them with a
  manual one.
- Every queue and map has a bound in `ServerLimits` and a stated overflow: a call over a bound fails
  with `protocol.busy` or `protocol.too_large`, a connection over one is refused with 503, a slow
  client is cut with 1013 and resumes its topics.
- A secret never reaches a log, an error or a stored row: a log line names the connection by its
  id, and idempotency keys are kept per credential id.
- Tests over real sockets live in `src/e2e/`, on `127.0.0.1` with ephemeral ports, and close every
  socket and listener. Only `src/e2e/` may import `@binference/client`.
