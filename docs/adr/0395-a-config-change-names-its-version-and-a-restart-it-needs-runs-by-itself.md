# 0395. A config change names its version, and a restart it needs runs by itself

Status: Accepted

Accepted by the tech lead on 2026-11-07, on the owner's ask to change settings from a chat with
patches, restarts and keys handled end to end. Amends [decision 0393](../DECISIONS.md#d0393).

## Context

[Decision 0393](0393-any-setting-changes-from-a-chat-with-a-card-the-owner-confirms.md) lets the
owner and the agent change any setting from a chat with a card. In its first use the agent replaced
a setting the owner had chosen a moment before, named a credential that did not exist, and the card said
"applies after a restart" with nothing that restarts. A patch made from an old read could also
overwrite a change made since, and a list given whole could drop entries nobody meant to drop.

## Decision

- `config/view` answers `hash`, the SHA-256 of `config.json5`. `config/propose` takes `baseHash`;
  a file whose hash differs is `config.changed`, and the agent reads again. The agent always sends
  it; the owner's `/config` sends none.
- A patch that drops entries from a list is `config.list_shrinks` unless `replacePaths` names that
  list. The owner's `/config set` and `/config unset` name the key they type.
- A secret source a change adds must have a secret behind it when the change is proposed: a
  credential, variable, keychain entry or file that is not there is `config.secret_unreadable`.
  A `fromCommand` source is never run to check, since nothing runs before the owner's tap.
- A confirmed change that applies only after a restart restarts binference by itself, 2 seconds
  after it is written so its receipt reaches the chat first. The stopping engine leaves
  `restart.json` in the state folder, runs its shutdown sequence, and the process starts it again,
  in the background service and in the terminal alike. Once the new engine serves, it reads and
  removes the record and sends `notice.restartedForConfig` with the keys applied.
- `engine/restart` (`admin`) asks for the same restart; the owner's Telegram chat runs it as
  `/restart`, and the next engine sends `notice.restarted`.
- The agent changes a setting only when the owner asks for that change. To do another task it uses
  the settings as they are, and when a tool fails because of one it tells the owner what failed and
  which change would fix it.

## Consequences

- A change from a chat never overwrites one made since it was read, never drops list entries by
  accident and never points at a secret that is not there.
- A setting that needs a restart takes effect without the owner running a command, and the owner
  hears when binference serves again.
- A restart closes the agent's running turn and every connection, as `binference restart` does.

## Alternatives

- **Let the OS service manager restart the engine on a failure exit.** It works only under the
  service, waits up to a minute on Windows, and counts toward the service's failure limits.
- **Run a `fromCommand` source to check it.** The agent could make the engine run a program before
  the owner taps.
