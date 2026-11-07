# 0393. Any setting changes from a chat, with a card the owner confirms

Status: Accepted

Accepted by the owner on 2026-11-07. Amends [decisions 0134](../DECISIONS.md#d0134) and
[0377](../DECISIONS.md#d0377).

## Context

Settings change from the CLI, the console or the Mini App. The owner's Telegram chat changes only
its language and how replies show (decisions 0134 and 0377), and the agent changes none: asked to
set the image model, it answered that it has no tool for that and told the owner to edit the file.
The owner wants to configure the agent from any interface, Telegram first, and to have the agent do
it when asked, as other agents do.

## Decision

- Any key of `config.json5` may change from a chat, money safety included (the owner chose
  "Everything"). Every such change is a card the owner confirms with a tap: nothing changes from a
  message alone. Operations that need the owner key (the rescue address, a ceiling, a wallet's
  export, a signer's removal) stay at the terminal, since they are not settings; a limit still
  changes through `limit/set`, a looser one after its wait.
- A config change is an intent of a new kind, `configChange`, with no step, as an unfreeze or an
  auto order's card has none. It is stored live in any mode, since a setting has no paper side,
  under the agent named, or the install's only active agent, and its default wallet. Its request is
  a JSON merge patch over `config.json5` and a reason; its quote names each key it changes, at most
  20, the value the engine runs with before and after (a secret source shown as its kind), and
  whether a restart applies it. Its card stays open 10 minutes, never passes auto mode, signs
  nothing, so a locked engine takes its tap, and warns when the agent proposed it after reading
  outside content.
- The tap applies the patch as `config/change` does (decision 0208): checked in every layer the
  engine runs with, written in place, journaled once with the owner who tapped as its author, and
  announced, and the receipt says how many settings changed and whether some wait for a restart.
  A key whose value moved since the card showed it ends the intent `failed_check` with
  `config_moved`; a patch the config no longer takes, with `config_invalid`. Nothing is written
  then. A key that already holds its new value counts as applied, so a change a stop cut short
  after its tap applies once: the next proposal applies it first.
- `config/propose` (`propose` scope) makes the card: from the owner's CLI, console or Telegram chat,
  or from the agent runtime, whose turn's outside-content mark it carries. An MCP client is refused.
  `config/view` (`read` scope) answers the config, or one key, with what each key takes, every
  secret source shown as its kind. A patch that writes a secret's value is `config.secret_inline`,
  as for `config/change`: a chat never carries a secret. The owner's Telegram chat runs both
  operations, its proposals the owner's.
- Telegram gets `/config`: `/config` and `/config <key>` show the settings, `/config set <key>
<value>` and `/config unset <key>` open the card in the chat; a value that reads as JSON is taken
  as JSON, any other as text. The agent gets `settings_read`, a read tool for the config and what
  each key takes, and `settings_change`, a propose tool that proposes keys and values with a reason.

## Consequences

- The owner sets the image model, a model, a limit default or the shell's settings from Telegram,
  or by asking the agent, and sees exactly what changes before it does.
- A stolen Telegram session can now open and confirm a card that loosens a setting, which the owner
  accepted; the owner-key operations, limit waits and the ceiling still bound what money can move.
- A prompt-injected change shows the outside-content warning on its card and still needs the tap.

## Alternatives

- **Keep settings off the chat, as decision 0134 had it.** The owner asked for the opposite.
- **Let the agent apply allowed settings at once.** A prompt injection would change settings with
  no tap.
- **Show a question instead of a card.** A question's answer is a message any surface can write;
  a card's Confirm is the tap the owner's surfaces already guard.
