# 0416. No stored text holds U+0000, on either database

Status: Accepted

Accepted by the tech lead on 2026-11-12. Amends
[decision 0367](0367-each-install-keeps-its-own-pair-of-postgres-schemas-with-sqlite-s-row-shapes.md):
a JSON field query on Postgres casts its column's text with U+0000's escape replaced.

## Context

SQLite stores U+0000 in a `TEXT` value and as `\u0000` inside JSON text. Postgres refuses both:
a `text` value with it fails with `invalid byte sequence for encoding "UTF8": 0x00`, and JSON
text with `\u0000` stores as `text` with `IS JSON` (spec 3, section 6.3) but fails with
`unsupported Unicode escape sequence` once a query casts it to `jsonb`, as every JSON field read
does. So a write that works on a self-hosted install fails on Cloud, and on Cloud one stored row
with `\u0000` can break later reads over its whole table.

U+0000 can arrive from every place outside text enters: the owner's typed text in the console,
the terminal and Telegram; a model's answer, reasoning and tool-call arguments; tool results
(shell output, file reads, browser and PDF text, API answers); helper reports, notes, goals and
progress notes, which a model writes; webhook alert bodies; and chain reads, such as an ERC-20
`name()` or `symbol()` decoded from a `bytes32` with zero padding, or a launch's name.

## Decision

- **Every boundary replaces U+0000 with U+FFFD before anything uses, hashes or stores the text.**
  One helper does it, `replaceNul` of `@binference/core`, the lowest package every boundary
  shares: `replaceNulDeep` walks a JSON value whole, keys and strings both, and
  `replaceNulInJsonText` reads JSON text, the character and its escape `\u0000` alike, with no
  other character of it changed. The boundaries:
  - the protocol server, on each frame's text before it is decoded, where JSON writes U+0000 as
    its escape, so the console, the terminal, MCP clients and the agent runtime's calls come in
    clean; a pass over the text is bounded by the frame's size, where a walk of the decoded args
    could run out of stack on a deeply nested frame;
  - the Telegram ingress, on each update before it is screened or stored, which carries every
    word the owner types there to the fast commands and the agent;
  - the agent runtime, on each model response (its text, its reasoning, each tool call's id, name
    and arguments, an argument's escape included) and on each tool result before it is written or
    read back to the model, so a turn, a summary, an image description and a helper's report
    alike come in clean;
  - the engine's wake-ups (`wakeWithMessage`), on the words it stores for the agent, such as a
    shell command's last lines;
  - the chain reads of a token's symbol and name and of a launch's symbol and name.
- **Never change text after it was hashed, signed or shown.** Each boundary sits before any terms
  hash, ledger hash, idempotency record or card line is computed from the text, so what the owner
  confirmed is what is stored.
- **Keep bytes exact where they must stay so.** A webhook alert's body that holds U+0000 is kept
  as its bytes in base64, which the alert already carries for a body that is not UTF-8, and fills
  as any alert does. Its `id`, the repeat key, is read with U+FFFD in place.
- **On-chain names are trimmed first.** A symbol or name read from the chain drops its trailing
  zero bytes, the padding of a `bytes32`, before the general replacement turns any U+0000 left
  inside it into U+FFFD (`onChainText` of `@binference/chain-evm`).
- **The store is the backstop, on both databases.** Every store task refuses input that holds
  U+0000 in any text or key with `store.nul_text`, before it reads or writes anything. The check
  lives in `defineTask`, which every task of both databases runs through, reads included, since
  a read's bound text fails on Postgres too. The fakes of the stores outside text reaches (the
  agent inbox, the Telegram and webhook inbox, the webhook alerts, the launches, the transcript
  and the notes) refuse alike, and each of their contract suites holds the refusal on SQLite,
  Postgres and the fake. A boundary missed then fails the same on a self-hosted install and on
  Cloud.
- **A row stored before this decision is cleaned where it is read back for a new write.** The
  agent runtime takes each message of the engine's inbox, and each message a turn takes from the
  chat queue, with U+FFFD in place of each U+0000, and a goal's write keeps its stored note and
  pause reason the same way; the Telegram ingress handles each stored update the same way. So a
  message an upgrade found waiting is answered, not refused.
- **One message the runtime cannot take never fails its start or its agent's line.** It stays in
  the engine's inbox for the next listing, with a log line naming its agent and the error's code,
  and the messages after it go on.
- **A JSON field query on Postgres reads past an old escape.** The Postgres forms of `jsonField`
  and `jsonArrayLength` cast `replace(text, '\u0000', '\ufffd')` to `jsonb`, so a row stored
  before this decision never fails a query over its table. Only such an old row can hold the
  escape now. The plain `replace` also reads the text `\\u0000`, an escaped backslash
  and the letters, as U+FFFD, where SQLite reads it as itself; it stays, since the fields
  `jsonField` reads are written by binference (trigger states, addresses, ids), never typed by a
  person.
- **Two kinds of text are not replaced.** A venue's plan is replayed to the venue to build the
  trade, and the thinking a model's replay keeps carries the provider's signature: changing either
  could change the trade or void the replay. The replay's other blocks, its text and its calls,
  are replaced as the response's own. A U+0000 in a plan or a signed thinking reaches the store,
  which refuses it alike on both databases, so the intent or the turn fails closed.

## Consequences

- The same write succeeds or fails alike on a self-hosted install and on Cloud.
- A token symbol or name with U+0000 inside it shows U+FFFD where it used to lose the character.
- A self-hosted install may hold rows with U+0000 from before this decision; SQLite reads them as
  before, and the reads that write them again clean them. No agent moves from a self-hosted
  install to Cloud in v1. A move added later copies each row through `replaceNulDeep` before the
  store's check sees it, and the `jsonField` form reads any escape it missed.
- An owner's message waiting in the engine or in the chat queue across the upgrade is answered
  with U+FFFD in place of its U+0000. A message the runtime still cannot take waits in the
  engine's inbox and is tried again at each listing; the runtime's logger writes nowhere today, so
  only the engine's inbox shows it.

## Alternatives

- **Refuse U+0000 at every boundary instead of replacing it.** An answer would fail for a
  character nobody sees. Rejected.
- **Strip U+0000.** It joins the words around it and hides that something was there. Rejected.
- **Escape U+0000 only for Postgres.** The two databases would store different text, and a
  backup moved between them would change it. Rejected.
- **A database check constraint on each text column.** Many columns, two dialects, and the
  refusal would come after the task already did its work. Rejected for the one check in
  `defineTask`.
