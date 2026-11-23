# 0455. The landing page opens awake, with no tap before it

Status: Accepted

Accepted by the owner on 2026-11-23.

Amends [decision 0452](0452-the-landing-site-is-a-next-js-app-whose-agent-is-a-living-engraving-of-the-mark.md)
on how the page opens.

## Context

Decision 0452 opens the landing page on one gold dot: nothing shows until the reader taps it,
as the agent waits for a tap before it moves funds. Seen on the built site, the owner found the
first tap a poor start: a reader who came to learn what the agent does meets a closed page and a
puzzle. The hero's words spoke to that tap ("You tapped. Now I am awake."), and the first tap was
counted in the header's tally.

## Decision

- The page opens at once. On its first frame the agent wakes: the mark draws itself in, the
  first words rise, and the agent's eyes open in the corner.
- The hero says what the agent is: an agent of the reader's own, on BNB Smart Chain, open source
  and on their Mac, that moves nothing without their tap.
- The gate, its words and the body class that kept the page closed are deleted. The tally starts
  at zero and counts the reader's taps on the page's own cards.
- Everything else in decision 0452 holds.

## Consequences

- A first visit shows the agent and what it does in the first screen, with no step before it.
- The idea of the tap moves from the page's door to its cards, the demo and the trust diagram,
  where it is what the agent does.
- A reader without JavaScript still sees no hero words, as before: they rise when the page opens.

## Alternatives

- Keep the gate but open it on its own after a pause: the reader still waits on nothing.
- Keep the gate on the first visit only: the first visit is the one that matters.
