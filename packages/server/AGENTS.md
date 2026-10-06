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
- No connection is trusted for its address. Tokens sign in over IPC only and devices over WS
  only.
- Time and randomness come through the `Clock` and `Random` ports: call timeouts and push retention
  run on the clock, so tests drive them with a manual one.
- Every queue and map has a bound and a stated overflow: a call over a bound fails with
  `protocol.busy`, a push to one topic too many is refused.
- A secret never reaches a log, an error or a stored row: idempotency keys are kept per credential
  id.
