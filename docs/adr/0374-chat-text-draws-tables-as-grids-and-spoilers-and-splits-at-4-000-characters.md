# 0374. Chat text draws tables as grids and spoilers, and splits at 4,000 characters

Status: Accepted

Accepted by the tech lead on 2026-11-05.

## Context

[Decision 0370](0370-the-agent-s-chat-text-shows-its-markdown-in-a-fixed-set-of-telegram-tags.md)
draws the agent's Markdown in Telegram from a fixed set of tags. Models answer with tables often,
such as prices or holdings side by side, and a table's rows reached the owner as lines of pipes
and dashes. A `||spoiler||` showed its pipes. Headings drawn bold read as louder than the answer
around them. A message split at Telegram's limit of 4,096 characters leaves no room when Telegram
counts a character differently from us.

## Decision

It amends decision 0370.

- **Tables.** A row with a `|` right above a delimiter row of as many cells (`| --- | :--: |`)
  starts a table, which runs to the first line without a `|`. It is drawn as a code block's
  fixed-width grid: `| a   | b   |`, each column padded to its widest cell and at least 3 wide, a
  `| --- |` line under the header, each cell's Markdown read and shown as plain text, `\|` a pipe
  inside a cell. East Asian wide letters and emoji count two cells.
- **Spoilers.** `||text||` is drawn in `tg-spoiler`, which joins the fixed set of tags. A single
  `|` and a run of three stay text.
- **Headings.** A heading is a plain line; its inline styles stay.
- **Split.** A message of the agent's text, and the status message, holds at most 4,000
  characters of HTML.

## Consequences

- Tables line up in the owner's chat in both languages; a cell's styles and links are lost
  inside the grid.
- Fast-command replies, notices and cards keep their own rendering and split at 4,096.

## Alternatives

- **One line per row as bullets.** Columns no longer line up, which is what a table is for.
- **Keep tables as text.** The owner reads the Markdown's pipes and dashes.
- **Bold headings.** A heading would read as a warning in a short answer.
