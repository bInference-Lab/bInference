# 0281. A launchpad may show warnings of its own on every launch card

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

A launch card shows the engine's warnings (spec 4, section 3.4) and every setting a launchpad
declares (decision [0235](0235-a-launch-card-shows-every-setting-its-terms-hash-binds.md)). Some
facts belong to one launchpad and hold for all its launches, and are no setting. Brew's site says,
read on 2026-10-20: "Brew is not available to U.S. citizens." binference calls Brew's contracts
directly, so the owner never sees that page. The owner allowed Brew launches on 2026-10-20, with a
warning on every Brew launch card, in English and Chinese.

## Decision

- **Declared by the launcher.** A launcher may declare `cardWarnings`: names in camelCase, each
  once, else the venue is refused when it is defined (`plugin.bad_venue`). Each name's message is
  `launch.warn.<name>`, which must exist in every language, else the launchpad is refused when it
  is hosted (`venue.bad_declaration`), as a setting with no card line is.
- **Kept with the launch.** The launch's quote keeps the names its launchpad declared at its build,
  so the card's terms hash binds them and a card drawn later shows the same warnings.
- **On the card.** Each shows as a warning line of its own, after `card.warn.noDeadline` and
  `card.warn.unboundFirstBuy`.
- **Brew's** is `notForUsCitizens`: "⚠️ Brew's site says it is not available to U.S. citizens",
  with its Chinese words in the catalog.

## Consequences

- `Launcher` gains `cardWarnings`, the launch host `cardWarnings`, the stored launch quote
  `warnings`, the card's warnings `launchWarnings`, and the card keys `launch.warn.<name>`. Spec 4
  says so.
- A warning is a fixed text: it carries no value and changes no step of the launch.

## Alternatives

- **A setting the owner must turn on.** It would ask the owner for an agreement on every launch,
  which the owner did not ask for. Rejected.
- **A line in the docs alone.** The owner asked for it on the card. Rejected.
