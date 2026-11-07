# @binference/chart

## Purpose

A chart the agent shows the owner, as text for surfaces that draw none and as shapes for those
that draw it.

## API

| Export           | What it does                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| `chartTextLines` | A chart as text: its title and kind, then a line per slice or series.          |
| `chartLayout`    | A chart laid out in a size: its plot, value ticks, category labels and shapes. |
| `ChartLayout`    | What `chartLayout` answers.                                                    |

## Example

```ts
import { chartLayout, chartTextLines } from "@binference/chart";

const chart = {
  chartType: "pie",
  title: "Holdings",
  segments: [{ label: "BNB", value: 3 }],
} as const;
const lines = chartTextLines(chart);
const layout = chartLayout(chart, { width: 480, height: 240 });
```
