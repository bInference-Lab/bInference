# 0391. Terminal chat takes a credential in a masked entry

Status: Accepted

Accepted by the lead on 2026-11-07. Amends [decision 0388](../DECISIONS.md#d0388).

## Context

Decision 0388 lets the owner answer the agent's credential request in the console's masked prompt
or with `binference credential set`; terminal chat only says where to answer. An owner chatting in
the terminal then has to leave it, open a second terminal and type the name again, while the
request runs out.

## Decision

- While the agent's credential request is open, terminal chat shows a masked entry under the
  request: the row "DUNE_API_KEY: type it, then Enter stores it · Esc skips", and one dot per
  character typed where the owner's line was.
- Every key but Ctrl+C, Ctrl+Y and Ctrl+N goes to the entry; a digit is a character, never a
  question's choice. What is typed lives only in the entry, never in the chat's state, its
  screen or a message; Enter sends it once with `credential/answer`, for the hosts the agent
  proposed, and forgets it. Esc skips with `credential/skip`. Editing the hosts stays with the
  console and `binference credential set --allow-host`.
- A paste that holds more than one line is refused whole, keeping what was typed before it, so a
  value with a stray line break never lands half.
- The request closing on any surface, or at its time, takes the entry off and says how it ended.
- Telegram still takes no credential: a chat message there is stored and seen by the model.

## Consequences

- The owner answers where they already are, in time.
- The terminal's own scrollback never holds the value; the terminal's line editing (history,
  kill ring) never sees it either, as the chat reads keys in raw mode.

## Alternatives

- **Edit the hosts in the terminal too.** A second field in a few live rows; the console and the
  command line already do it, and most requests keep the hosts the agent proposed.
- **Read the value with the CLI's hidden prompt.** It would stop the chat's live area and its
  keys while the owner types.
