# 0370. The agent's chat text shows its Markdown in a fixed set of Telegram tags

Status: Amended by 0374

Accepted by the tech lead on 2026-11-05, on the owner's approval.

## Context

[Decision 0178](0178-telegram-chat-batches-the-owner-s-messages-and-previews-give-way.md) sends
the agent's text in Telegram's HTML with every character escaped, so markup in it reads as text.
Models write Markdown. The owner chatted with the beta's bot and saw the agent's answer with its
marks showing, such as `**paper mode**` with its asterisks. The owner approved showing the
agent's text as Telegram's rich text.

The text is outside content: a model writes it, and what it read may steer it. HTML the model
writes must never reach Telegram as tags, a link must not open anything but a web page, and a
message Telegram refuses must still reach the owner. Telegram's HTML takes a small set of tags,
refuses a message whose tags do not balance, and holds at most 4,096 characters.

## Decision

It amends decision 0178's rule for model text.

- **Markdown in, a fixed tag set out.** binference's own reader turns each line of the agent's
  text, after `displayOutsideText`, into runs of plain text with styles. The renderer writes only
  `b`, `i`, `s`, `code`, `pre`, `a` and `blockquote`, from fixed strings, around text it escapes
  itself. `pre` takes a `language-` class only when the language is letters and digits. `a` takes
  only an `http:` or `https:` address of plain URL characters, at most 2,048 of them; any other
  link, `javascript:` and `tg:` among them, shows as the text it is.
- **Headings and lists.** A heading is a bold line, a bullet item a `•` line, a numbered item
  keeps its number, a nested item sits two spaces further in per level, and a rule is an empty
  line.
- **Never the model's HTML.** A tag, an entity or a `<script>` in the text shows escaped. A mark
  that never closes shows as its characters, and each line's tags close at its end, so every
  message's tags balance.
- **Split.** A message holds at most 4,096 characters of HTML. A long answer splits at a
  paragraph break once half a message is filled, else at a line break, and a line longer than a
  message at whole characters. Each message renders its own tags, so a style or block cut in two
  closes in one message and opens again in the next.
- **Plain text when refused.** When Telegram answers a message with a 400 that it cannot parse
  its entities, that message goes once more as its plain text, with no parse mode: the same
  words with no tags and no escapes, each link's address after its label. The log names the new
  message's id, never its words.
- **Only the chat text.** Cards, receipts, notices, fast-command replies and the status message's
  preview keep their own rendering.

## Consequences

- The owner reads the agent's answers as formatted text, in English and in Chinese.
- The Markdown readers make runs and lines only; HTML comes from one renderer, which the
  package's rules name.
- A link's label can differ from its address. Telegram shows the address before it opens a link
  whose label differs.
- A mark further than 4,000 characters from its close shows as its characters, which bounds the
  work of a text full of unmatched marks.
- The log gains a `messageId` field, which the support bundle keeps as a number.

## Alternatives

- **Keep escaping everything.** The owner reads raw marks in every answer. Rejected.
- **Pass the model's HTML through a filter of allowed tags.** Any filter gap reaches Telegram as
  markup the model chose, and a broken tag refuses the whole message. Rejected.
- **A Markdown library.** It adds a runtime dependency to the bot for a small subset of Markdown,
  and its HTML would still need the same allow-list. Rejected.
- **Telegram's MarkdownV2 parse mode.** It refuses a message for any unescaped reserved
  character, which model text holds all the time. Rejected.
