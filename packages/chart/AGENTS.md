# @binference/chart

A chart the agent shows the owner (decision 0387), as text for a surface that draws no chart and
as shapes for one that draws it.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is pure and runs in a browser: no Node built-in, no I/O.
- It reads the protocol's `PortableChart` and never formats a number for people: the text form
  writes each value as it came, and the layout answers value ticks as numbers, which each surface
  formats through i18n.
- The layout answers shapes in the size it is given; each surface paints them in its own colors,
  one per series.
- Its public API is what `src/index.ts` exports; every export carries TSDoc.
- Tests sit beside the code as `*.test.ts`.
