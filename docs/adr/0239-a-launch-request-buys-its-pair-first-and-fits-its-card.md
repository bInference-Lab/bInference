# 0239. A launch request buys its pair first and fits its card

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

A `launchToken` names the asset its token trades against (`pairWith`) and a first buy
(`firstBuy`), and [decision 0235](0235-a-launch-card-shows-every-setting-its-terms-hash-binds.md)
cuts a card's description at 1,000 characters and a link at 200. The second review of the launch
found two gaps:

- Nothing compared the first buy's asset with the pair. A request paired with one asset could buy
  first with another, or with an asset on another chain: the launcher decided what that meant, and
  the card read "paired with WBNB · first buy 10 USDT".
- The protocol takes a description of any length and links of up to 512 characters, which are
  uploaded and bound by the terms hash, while the card cuts them: the owner could confirm words the
  card did not show.

## Decision

- **The first buy spends the pair.** A launch whose first buy is in any asset but `pairWith` fails
  with `protocol.bad_args` before anything is stored.
- **The words fit the card.** A launch whose description is longer than 1,000 characters, or one
  of whose links is longer than 200, fails with `protocol.bad_args` before anything is stored. A
  character is a Unicode code point, as the card counts it.

## Consequences

- A launch card's pair and first buy name one asset, and its words are what is uploaded, in full.
- A launchpad that takes a first buy in the chain's coin for a pair in its wrapped coin needs a
  new decision before its plugin can offer it.
- The protocol's schema keeps its wider bounds, so the snapshot of version 1 does not change; the
  engine refuses what the card cannot show.

## Alternatives

- **Narrow the protocol schema.** A narrower argument breaks version 1's snapshot. Rejected.
- **Let the card show the whole text.** A launch card is long already, and Telegram's message limit
  bounds it. Rejected.
