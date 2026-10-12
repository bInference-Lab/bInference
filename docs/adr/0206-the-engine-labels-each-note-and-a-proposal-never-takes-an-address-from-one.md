# 0206. The engine labels each note, and a proposal never takes an address from one

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[Spec 8](../specs/runtime.md#section-10) section 10 routes `notes/*` to the agent runtime with an
origin the engine sets from the caller, and section 5.4 stores a note written in a marked turn as
`untrusted`. [Rule 10](../ARCHITECTURE.md#rule-10) makes the registry the only source of contract
addresses, and [spec 3](../specs/database.md#section-3) section 3 says notes never hold an address
as a source for actions. The specs leave open:

- **Who decides `untrusted`.** The route line carries `owner`, `agent` or `system`; the turn's
  mark lives in the runtime and, after `turn/mark`, in the engine.
- **A query under three characters**, which the trigram index cannot match: two Chinese
  characters are a whole word.
- **A note that is not there** for `notes/delete`: spec 1 has no code for it.
- **How a propose tool knows where an address came from.**

## Decision

- **The engine sets every origin.** `owner` for a client with `confirm` or `admin`. `agent` only
  for the runtime the engine runs now, in a running turn of the agent the call names whose mark is
  not set. `untrusted` for every other caller: the runtime in a marked turn or outside any turn,
  and any other client with `agent`. The route line gains `untrusted`. The runtime stores the
  origin it is given and never picks one.
- **Short queries.** A query of one or two characters finds the notes whose text holds it, in any
  ASCII letter case, oldest first, with `%` and `_` matching themselves. A longer query uses the
  trigram index, best match first.
- **`note.not_found`** answers `notes/delete` for a note that is not there or was removed.
- **The note-address check.** Before a propose call runs, and before it can commit the turn, the
  runtime reads every address (`0x` and 40 hex digits) in the call's arguments and every address
  the conversation the model sees holds, by where it came from:
  - a source: the owner's own messages and the engine's messages to the turn, and the results of
    the tools that read the engine's facts (`token_search`, `portfolio`, `token_info`,
    `token_risk`, `quote`, `orders`, `tx_status`), less any address the call's own arguments named,
    so a lookup does not vouch for the address it was given;
  - a note: the results of `notes_search`;
  - neither: a summary of earlier history, and every other tool's result.

  A proposal whose address a note holds and no source does is refused, "not run", with how to find
  the address another way; the turn is not committed and the model may correct the call.

## Consequences

- A turn that read outside content cannot write a note that a later, clean turn reads as the
  agent's own: the label comes from the engine, which holds the turn's mark.
- `notes_search` answers two-character Chinese words, at a scan of the agent's notes.
- An address the agent remembered in a note reaches a proposal only after the owner or an engine
  read gives it again; a token the registry lists is one `token_search` away.
- An address in the summary of compacted history is neither allowed nor refused by a note: a note
  read before compaction no longer refuses it, and a note read after it still does.
- Spec 1 gains `note.not_found`, and spec 8's route line gains the origin `untrusted`.

## Alternatives

- **The runtime labels the note from its own mark.** The runtime is the caller being labelled, and
  a client with `agent` that is not the runtime would label itself. Rejected.
- **Nothing found under three characters.** Two Chinese characters are a common word. Rejected.
- **Refuse every address that comes from no source.** It would also refuse an address the model
  read on a web page, which the outside-content mark and the risk check already cover, and break
  proposals the specs allow. Rejected for the narrower rule this decision keeps.
- **Hide addresses in note text.** A note about a past trade would lose what it says. Rejected.
