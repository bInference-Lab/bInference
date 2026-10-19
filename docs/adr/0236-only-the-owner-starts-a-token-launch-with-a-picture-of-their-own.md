# 0236. Only the owner starts a token launch, with a picture of their own

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
lets any proposer of `intent/propose` start a `launchToken`, and reads its picture by any upload id
the engine holds. A launch publishes its words and picture on the launchpad's storage before the
owner's tap, and makes a token in the owner's name. Two cases are open:

- The agent runtime or an MCP client could start a launch, so words and a picture the owner never
  saw go public before any card.
- An upload id names bytes, not who sent them, so a proposer could launch a picture another
  credential uploaded.

The owner decided on 2026-10-19: only the owner starts token launches.

## Decision

- **The owner alone.** A `launchToken` proposed by the agent runtime or an MCP client fails with
  `intent.owner_only` before anything is read, stored, quoted or uploaded. Its words, in English
  and Chinese, tell the agent to suggest the launch to the owner in chat instead.
- **The owner's surfaces.** A launch comes only from a proposer the engine counts as the owner:
  the CLI, the console, the Mini App, and the owner's Telegram chat as spec 1's scopes allow.
- **The owner's own picture.** The engine's upload shelf keeps, with each upload, the credential
  that held its ticket. A launch reads its picture only when that credential is the one the owner
  proposed with; any other upload, like one the engine does not hold, ends the launch
  `failed_check` with `image_unreadable`, nothing uploaded.

## Consequences

- No launch goes public without the owner starting it on one of their surfaces.
- The agent can still plan a launch and suggest it in chat; the owner starts it.
- The protocol gains `intent.owner_only`; the upload shelf gains `holderOf`, and the launch image
  port reads the holder with the bytes.
- An upload made on the Mini App serves a launch proposed from the owner's Telegram chat, since
  both carry the owner's Telegram credential; one made on the CLI does not serve the console.

## Alternatives

- **Let the agent propose and rely on the card.** The upload happens before the card, so the
  words and picture are public before the owner sees them. Rejected by the owner.
- **A setting that lets the agent launch.** It would bring back what the owner ruled out.
  Rejected.
- **Check the picture's holder by surface rather than credential.** Two devices of one surface
  would share uploads, and the engine reads the credential, not the surface, from the server.
  Rejected.
