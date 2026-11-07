# 0388. The owner stores credentials the agent never sees

Status: Amended by 0390

Accepted by the owner on 2026-11-07.

## Context

Some tasks need a credential, such as a data provider's API key. Pasted into the chat, a key would
reach the transcript, the model's context and every log that keeps a message, and the agent could
send it anywhere.

## Decision

- The engine keeps the owner's credentials in `credentials` (engine migration 0063): a name written
  as an environment variable's, the value, the exact hosts it may be sent to, and when it was
  stored. No read gives a value back. A removed credential leaves every read at once and is purged
  with its value 30 days later by the daily prune. Values are kept in `engine.sqlite`, an
  owner-only file whose backups are sealed to the owner key.
- Operations, additions to protocol version 1, none with an idempotency key, so no value is kept
  in the idempotency store: `turn/credential` (from the current runtime only) asks the owner for a
  credential with the agent's reason and proposed hosts, one open request per agent, answerable for
  15 minutes or the 30 to 3600 seconds the agent names; `credential/answer` stores the owner's value
  with the hosts the owner kept, `credential/skip` declines; `chat/openCredentialRequest`,
  `credential/list` (names and hosts only), `credential/delete` and the owner's `credential/set`.
  Pushes `chat/credentialRequest` and `chat/credentialRequestClosed` (stored, skipped, expired,
  replaced) go on the agent's chat topic.
- The owner answers in the console's masked prompt, which shows who asks, the name, the reason,
  whether one of the name is stored, and hosts the owner can edit, or with `binference credential
set`, whose value comes from a masked prompt, never a flag. Telegram and terminal chat say where
  to answer and never take a credential: a reply there is a message like any other.
- The agent gets `credentials`, a control tool with `list`, `request` and `delete`. A request ends
  the turn; the owner's answer starts the next with what arrived, never the value. No action writes
  a value the agent supplies.

## Consequences

- A credential reaches the engine without passing the chat, the transcript or the model.
- The stored hosts bind where a credential may go; the egress that uses them is its own step.
- A request asked in a turn waits for the owner across turns, not inside the tool call.

## Alternatives

- **Hold the tool call open until the owner answers.** A call has 60 seconds and the protocol 30;
  ending the turn and starting the next one with the answer keeps both bounds.
- **Delete a value at once.** The 30-day window lets the owner restore by storing the name again,
  and the daily prune bounds how long a removed value stays.
