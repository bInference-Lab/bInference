# 0229. A Mini App uploads images through the public address on its own ticket

Status: Accepted

Accepted by the owner on 2026-10-16.

Amends [decision 0227](0227-an-image-reaches-only-a-model-declared-to-read-it-and-lives-for-one-turn.md).

## Context

[Decision 0227](0227-an-image-reaches-only-a-model-declared-to-read-it-and-lives-for-one-turn.md)
takes an upload only at the engine's own address. The Mini App reaches the engine only through
`remote.publicUrl`, whose origin opens `/ws` and the console's files and nothing else
([spec 1, section 2.1](../specs/protocol.md#section-2-1)), so `POST /upload/:ticket` answers it 404
and the owner cannot send an image from the console inside Telegram. The owner ruled on 2026-10-16
that the Mini App may upload through the public address with the same one-time ticket and the same
limits: 5 MiB an image, 4 images a message, PNG, JPEG or WebP.

The public address is reached from any device of the owner's tailnet, or from the internet under
`funnel`. A ticket is 256 random bits and works once for 2 minutes, but any credential with `chat`
can ask for one, and a ticket from a local console or the CLI has no reason to arrive through the
public address.

## Decision

- **The public address opens `POST /upload/:ticket` and no other new path.** `/pair` and `/health`
  stay 404 there.
- **A ticket is held for the credential that asked for it.** `upload/start` keeps the caller's
  credential id with the ticket: a device's `dev_` id, a token's `tok_` id, or `tg:<id>` for the
  Mini App.
- **Through the public address an upload needs the Mini App's session.** The request must carry
  the public origin, else 403 `auth.origin`, a request without an `Origin` included. Its ticket must
  be held by a `tg:` credential, and a connection signed in with that credential must be open when
  the body arrives. Any other ticket is used up and answered 404 `image.not_found`, the answer of an
  unknown ticket, so the public address tells a guesser nothing about tickets made on the machine.
- **On this machine nothing changes:** an upload comes from no browser or an origin of the allowed
  list, on any live ticket.
- **The limits are the engine's.** The body must have the size and format `upload/start` named, at
  most 5 MiB; a message names at most 4 uploads. The console checks the same limits before it
  uploads, and the engine enforces them.

Decision 0227 stays as written for everything else.

## Consequences

- The owner sends images from the Mini App as from the console on the machine.
- A Mini App that signed out, closed, or reached its 12 hours can no longer use the tickets it asked
  for; the console starts the upload again after it signs in again.
- A ticket made by the CLI or a local console device never works through the public address.
- The engine's HTTP listener reads up to 5 MiB from a request through the public address, but only
  for a request that names a ticket path; the body is checked against the ticket's plan as it
  arrives and dropped past 5 MiB.

## Alternatives

- **Keep uploads local and send images as base64 over the WebSocket.** A frame holds at most 1 MiB,
  and splitting images into frames adds a second upload path to keep. Rejected.
- **Accept any live ticket through the public address.** A ticket asked for on the machine would
  work from the tailnet. The ticket's secret alone would guard it, with no tie to the Mini App's
  sign-in. Rejected.
- **Bind a ticket to the connection that asked for it.** A Mini App launch signs in one
  connection ([decision 0160](../DECISIONS.md#d0160)), so the credential and an open session already
  tie the ticket to the owner's Mini App; two Mini Apps the owner opened share the credential, and
  either may upload. The engine knows a caller by its credential, not by the server's connection,
  so the connection would be a new field on every call for no stronger guarantee. Rejected.
