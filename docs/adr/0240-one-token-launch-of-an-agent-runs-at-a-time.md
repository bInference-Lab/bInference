# 0240. One token launch of an agent runs at a time

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

Each `launchToken` uploads its words and picture to its launchpad before its card
([decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)).
The second review of the launch found that nothing bounds how many launches wait: the same upload
can be proposed any number of times, and each proposal uploads again, so a launchpad's API may
refuse the install for the load.

## Decision

- While a launch of an agent is under way, from its proposal until it is signed or ends, another
  `launchToken` for that agent fails with `intent.launch_waiting` before anything is read, stored
  or uploaded. Its words, in English and Chinese, tell the owner to let the first finish, or deny
  its card, first.
- Under way means any state before signing: `proposed`, `checked`, `quoted`, `assessed`,
  `simulated`, `awaiting_confirmation` or `confirmed`. The engine reads every page of the agent's
  live intents in those states.

## Consequences

- An agent makes at most one upload a pin wait, and at most one launch card is open for it.
- An owner who launches two tokens confirms or denies the first card before the second upload.
- The protocol gains `intent.launch_waiting`.

## Alternatives

- **A count per hour.** It needs a window store and a number to tune; one at a time follows the
  owner's own pace. Rejected.
- **Reuse an upload a launch already made.** A new launch may change its words, and the pin
  belongs to the first launch's metadata. Rejected.
