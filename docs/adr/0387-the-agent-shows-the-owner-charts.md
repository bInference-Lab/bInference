# 0387. The agent shows the owner charts

Status: Amended by 0389

Accepted by the owner on 2026-11-07.

## Context

The agent answers with numbers often: a price over a day, holdings by token, profit by week. Read
as text they are hard to compare, and the console can draw a chart that Telegram cannot.

## Decision

- An operation, an addition to protocol version 1: `turn/chart` (`agent` scope, a read) takes a
  portable chart and pushes it on the agent's chat topic as `chat/chart`. A chart is a pie of 1 to
  12 segments with values above zero, or bars, areas or lines of 1 to 8 series over 1 to 100
  categories, each series named once and holding one value per category, with an optional name
  for each axis. A title is 1 to 80 characters and a label 1 to 40.
- Each surface shows it as well as it can: the console draws it as SVG in the theme's colors, one
  per series; Telegram and the terminal, which draw no chart, show its text form, the title and
  then a line per slice or series. The new pure package `@binference/chart` holds the text form
  and the layout, and never formats a number for people; the shared formatter gains `chartValue`
  for the console's axis.
- The agent gets `show_chart`, a control tool with one flat object of arguments, as every model
  provider's tool schemas accept. It names the chart's text as shown, so the answer never repeats
  its numbers (decision 0381).

## Consequences

- The owner reads trends at a glance in the console, and still gets every number in Telegram.
- A chart's words are the agent's; every surface shows them as text, never as markup.
- Telegram users see no picture; a drawn image there would need a renderer and its fonts.

## Alternatives

- **Draw a PNG for Telegram.** A picture reads better, but text in a PNG needs a font renderer the
  engine does not carry; the text form keeps every number readable.
- **Let the agent write a chart as a Markdown table.** Tables already show as grids, but they draw
  no trend.
