# 0383. The agent writes in one Markdown every surface renders

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

The agent's instructions said nothing about how to write an answer. A model then writes what it
likes: a closing line that adds nothing ("The deposit details are shown above."), whole sentences in
bold, long paragraphs on a phone, addresses outside code, amounts in base units. Telegram renders a
fixed set of Markdown (decision 0370), and the owner wants the same clean answers on the web.

## Decision

- The agent's fixed instructions carry one section on how it writes, for every surface: Telegram,
  the console and the terminal render the same Markdown, so the agent writes once.
- The section names what renders: paragraphs, bulleted and numbered lists, tables of two to four short
  columns, bold, `code`, quotes, headings and links with a label; and what never to
  write: HTML tags, escape characters for Telegram, images.
- It sets the style for a phone of about 40 characters a line: the answer first, with no greeting,
  restatement or closing offer; one to three sentences a paragraph; bold on the one thing the owner
  must not miss; every address, hash, command and file name in `code`, whole; a warning as a quote;
  amounts as people read them; no emoji unless the owner uses them; nothing that points back at
  what a tool showed, and no text at all when nothing is left to say.
- The deposit card follows the same look: the wallet's name in bold with its role, the address in
  `code`, the warnings in a quote, the explorer link last.

## Consequences

- Answers read alike on every surface and stay short and scannable.
- The console renders the same Markdown, through the reader the Telegram bot uses.

## Alternatives

- **A format per surface in each turn's context.** The stable prefix would change with the surface
  a message came from, and an answer goes to every surface at once.
- **Let each surface strip Markdown it cannot render.** The model would still write for no surface
  in particular.
