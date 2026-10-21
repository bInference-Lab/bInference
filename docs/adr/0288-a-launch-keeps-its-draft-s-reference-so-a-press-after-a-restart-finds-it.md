# 0288. A launch keeps its draft's reference, so a press after a restart finds it

Status: Accepted

Accepted by the tech lead on 2026-10-21.

## Context

[Decision 0285](0285-the-agent-drafts-a-token-launch-and-the-owner-starts-it-in-telegram.md)
keeps launch drafts in memory: a restart forgets every one, and a press on a draft the engine no
longer holds answers that the draft is gone and asks the owner to have the agent draft it again.

The crash suite
([decision 0287](0287-the-crash-suite-launches-flap-tokens-on-stand-ins-of-the-bare-chain.md))
showed a case the rule misses. Telegram hands the bot a press again when the engine stopped
before the bot took it. When the engine stops after the owner's Start proposed the launch, the
restarted bot gets the same press, finds no draft, and turns the draft's message into "draft it
again", while the launch goes on to its card and lands. An owner who follows those words makes
a second launch and a second token.

## Decision

- **The launch keeps the reference.** The one proposal a draft's Start makes carries the draft's
  reference, and the launch stores it in `intents.draft_ref` (migration 0049), set at the
  proposal in the same write as the intent. At most one intent holds a reference.
- **A press looks for the launch first.** An owner's press of Start or Drop on a reference the
  engine no longer holds reads the launch that reference started. When there is one, the press
  starts nothing, and the draft's message says where that launch stands: it already started and
  its card shows where it stands (`telegram.draft.launched`), or it ended before its card, with
  the reason (`telegram.draft.ended`). The answer to the press says the same in short. Only a
  reference that started nothing gets `telegram.draft.gone`.
- **Nothing else changes.** Drafts stay in memory, and a restart forgets them. Anyone but the
  owner gets no answer, as before.

## Consequences

- A press on a draft after a restart never invites a second draft of a launch already under way
  or done.
- The intent store gains `byDraftRef`; the intent record gains `draftRef`; the engine's caller
  gains `draftRef`, which only the draft's Start sets and the protocol server never does.
- Spec 3 gains `intents.draft_ref` with its unique index; spec 4 gains
  `telegram.draft.launched`, `telegram.draft.answer.launched` and `telegram.draft.answer.ended`.

## Alternatives

- **Store the drafts.** A table and a migration for drafts the agent can make again, which
  decision 0285 rejected; the launch is what the owner needs to find.
- **An idempotency key from the reference.** The protocol's idempotency records belong to the
  protocol server and are written after the proposal answers, so a stop between the launch's
  store and its answer would leave no record.
- **Ask Telegram not to hand the press again.** The bot cannot take an update it never finished;
  the press would still be lost or repeated by another stop.
