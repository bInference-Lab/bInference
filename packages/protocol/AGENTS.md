# @binference/protocol

The engine protocol as zod schemas: frames, credentials, ids, error codes and versions. The spec
is [docs/specs/protocol.md](../../docs/specs/protocol.md).

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
  kinds, new error codes. A removal or a change of meaning raises `protocolVersion`.
- An error code the spec adds goes into `protocolErrorCodes`; surfaces map each code to a message.
