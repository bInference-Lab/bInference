# 0285. The agent drafts a token launch and the owner starts it in Telegram

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0236](0236-only-the-owner-starts-a-token-launch-with-a-picture-of-their-own.md) lets
only the owner start a token launch: a `launchToken` the agent runtime or an MCP client proposes
is `intent.owner_only` before anything is read, stored or uploaded, and the agent may only
suggest a launch in chat. A launch publishes its words and picture before its card, so the owner
must see them before anything leaves the machine.

The owner's Telegram chat holds `read`, `confirm` and `chat` (spec 1, section 4.1), so no
message or press there proposes anything, and a suggestion in chat leaves the owner nowhere to
start it but the CLI. The plan's launch milestone asks for a launch from a chat.

The owner chose, on 2026-10-20, that the agent drafts the launch, the bot shows every value in
the owner's chat, and the owner's tap on Start starts it, with the launch card and its Confirm
still after.

## Decision

- **A draft, not a proposal.** `launch/draft` (scope `agent`) takes the launch's terms from the
  runtime the engine runs now, in its agent's running turn; any other caller is `auth.scope`, and
  a turn that is not running is `protocol.bad_args`. It runs the checks a proposal runs before
  anything is stored: the agent is active and live (else `agent.paper_only`), no other launch of
  the agent is under way (`intent.launch_waiting`), the terms resolve as decisions 0235, 0239,
  0276, 0277 and 0280 say, and the agent has a live launch wallet (else
  `intent.launch_wallet_missing`). Its picture follows
  [decision 0286](0286-a-launch-draft-s-picture-is-a-photo-from-the-owner-s-own-chat.md). It
  uploads nothing, quotes nothing and stores no intent.
- **In memory, 10 minutes, one per agent.** The engine keeps the draft with two random 12-byte
  values: its id, which its pushes carry, and the reference its buttons carry. A new draft of the
  agent replaces the open one. A restart forgets every draft. The draft ends `started`,
  `dropped`, `expired`, `replaced` or `failed`, and each end is pushed as
  `chat/launchDraftClosed` on the agent's chat topic; `chat/launchDraft` announces a new one.
- **Every value on screen.** The owner's chat shows the draft with the lines its card will show
  from the request: the action line, the description, each link, the picture and every launchpad
  setting with its default filled in, each value from the terms drawn as outside text. The fee,
  the new token and the first buy's least output come with the launch card, as the message says.
  Two buttons follow, Start launch and Drop, with `bnf1:s:<y|n>:<ref>`.
- **The one proposal the chat makes.** A press of Start by the owner's numeric Telegram id, in
  the owner's private chat, on an open draft proposes that draft's request through
  `intent/propose` as the owner on Telegram, with the owner's Telegram credential. The draft
  closes before the proposal, so a second press, a stale reference or an expired draft proposes
  nothing. Any other presser, chat or data does nothing. Drop closes it; the timer of the cards
  closes it when its 10 minutes end, and the message says so.
- **Nothing else changes.** A `launchToken` from the agent runtime or an MCP client through
  `intent/propose` stays `intent.owner_only`. The launch from a draft runs the whole launch path:
  the policy, the launch wallet, the upload, the pin, the simulation and the card, which the owner
  confirms with the card's own tap.

## Consequences

- A launch can start from a chat with the agent, and still nothing goes public before the owner
  has seen every word and tapped Start.
- The agent's words reach the launchpad once the owner taps Start; the draft and the card show
  them whole.
- The protocol gains `launch/draft`, the pushes `chat/launchDraft` and
  `chat/launchDraftClosed`, and `intent.launch_wallet_missing`; spec 4 gains the draft message
  and the callback kind `s`; the runtime gains the `launch_draft` tool; decision 0236 is amended.
- The console and the Mini App show no draft yet; a later task gives them the same Start.

## Alternatives

- **A `/launch` command with guided questions.** The owner types every value, and the agent
  plans nothing. Not chosen by the owner.
- **Launches only from the CLI or the console.** No launch from a chat. Not chosen by the owner.
- **Give the owner's chat the `propose` scope.** Every proposal of the chat would count as the
  owner's. Rejected: the exception is one press of one stored draft.
- **Keep drafts in the database.** A table and a migration for a suggestion the agent can make
  again after a restart. Rejected.
