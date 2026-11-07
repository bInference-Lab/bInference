# @binference/rich-text

## Purpose

The agent's Markdown read into lines of styled runs, which each surface draws in its own markup.

## API

| Export        | What it does                                                                       |
| ------------- | ---------------------------------------------------------------------------------- |
| `richLinesOf` | Reads the agent's Markdown into lines: text, quote and code blocks of styled runs. |
| `RichLine`    | One line: its block and its runs.                                                  |
| `isBlankLine` | Whether a line is an empty line of text: a paragraph break.                        |

## Example

```ts
import { richLinesOf } from "@binference/rich-text";

const lines = richLinesOf("Send **0.5 BNB** to `0xabc`");
```
