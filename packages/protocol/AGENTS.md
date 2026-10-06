# @binference/protocol

The engine protocol as zod schemas: frames, credentials, ids, error codes, versions and every
operation. The spec is [docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is pure and published: no I/O, no clock, no `process`. Every client, in any language, reads
  the protocol from here, so a shape lives here once and other packages import it.
- A frame is one `*-frame.schema.ts` file: its interface, then its schema annotated with it.
  `args`, `result` and `data` stay `unknown` at the frame; each operation and push kind parses its
  own.
- Frames parse with `z.object`, which drops fields it does not know, so an older client survives a
  field a newer engine adds. A credential is a `z.strictObject`: exactly one per `open`.
- Optional fields use `.exactOptional()`: on the wire a missing field is absent, never `null`.
- Inside a version, changes are additive only: new operations, new optional fields, new push
  kinds, new error codes. `pnpm check:protocol-compat` compares `describeProtocol()` with
  `snapshots/v<version>.generated.json` and fails anything else. After an addition, run it with
  `--write` and commit the snapshot. A removal or a change of meaning raises `protocolVersion`.
- An error code the spec adds goes into `protocolErrorCodes`; surfaces map each code to a message.
- An operation is one row in the table of its `src/operations/*-operations.schema.ts` file: its
  name, exactly one scope, the flags of its kind (`readFlags`, `writeFlags`, `localWriteFlags`
  and the others), and the schemas of its args and result. A call that needs another scope in
  some cases names it in `scopeCase`, never as a second scope.
- Args are `z.strictObject`, so the engine refuses fields it does not know; results are
  `z.object`, so an older client drops fields a newer engine adds. A shape used in both, such as
  an intent request, keeps one field list and builds both objects from it.
- Money is never a number on the wire: amounts use `amountSchema` or `decimalStringSchema`, a
  value that can fall below zero uses `signedUsdMicrosSchema`. A test walks every described
  schema and fails a money field that is not a string.
- Every operation has an example call in `src/examples/`; the table type makes a missing one a
  compile error, and a test round-trips each through its schemas.
