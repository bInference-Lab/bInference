# 0103. The engine runs locked until the agent key opens

Status: Accepted

## Context

The unlock mode reads the agent key and the Privy app secret at start
([spec 5, section 3](../specs/keys-and-backups.md#section-3),
[decision 0065](../DECISIONS.md#d0065)). Spec 5 says that while locked the engine answers reads, refuses signing with `engine.locked`, and
auto orders, auto mode and webhook rules wait. It does not say what the engine does when a mode
holds no key or cannot open it, what an owner's Confirm does while locked, how auto mode waits, or
which copy wins when a systemd unit passes credentials and `keys/` holds files too. The protocol
lists `engine.locked` as an error a call may meet and pass later unchanged
([spec 1, section 10](../specs/protocol.md#section-10)).

## Decision

- At start, the unlock mode opens both secrets or leaves the engine locked with a reason:
  `needs_passphrase`, `wrong_passphrase`, `agent_key_missing`, `agent_key_invalid`,
  `keychain_failed`, `command_failed`, `app_secret_missing` or `app_secret_unavailable`. A locked
  engine runs; it never refuses to start for one of these.
- While locked, a Confirm of a live intent fails with `engine.locked` and changes nothing: the card
  stays open, and the owner confirms again once unlocked, before the card expires. A Telegram tap
  on it is answered with the same words.
- Auto mode leaves a live intent to the owner: the auto test refuses it with `locked`, checked
  right after `manual`, and the card opens with the `autoAsks.locked` line.
- Reads, paper intents and Cancel work as ever. The notice `notice.locked` names no agent, since
  the lock holds for the whole install.
- In the `file` mode, the systemd credentials `binference-agent-key` and `binference-privy-secret`
  win entry by entry when the unit passes them; `keys/`, and `custody.privy.appSecret` for the app
  secret, are the fallback. No other mode reads credentials.

## Consequences

- Spec 4 gains `autoAsks.locked`, spec 5 section 3 says what a Confirm does while locked, and spec
  6 section 5 lists `locked` in the auto test.
- An intent confirmed in an earlier run waits at startup until the engine unlocks: recovery hands
  it to the executor only then.
- A card can expire while the engine is locked, and auto mode trades nothing until the owner
  unlocks.
- The start log names the reason, never a secret.

## Alternatives

- **Refuse to start without the key.** A keychain locked at boot would stop reads, paper trading
  and the notices, and the service manager would restart the engine in a loop. Rejected.
- **Take the Confirm and hold the confirmed intent until unlock.** The confirmation can expire
  before the owner unlocks, and the call would fail after the intent had moved. Rejected.
- **Hold an auto intent at `simulated` until unlock.** Its quote is stale after 10 seconds and
  nothing resumes it. Rejected.
- **`keys/` before the credentials.** A unit that passes credentials says the owner moved the
  secrets there; an old file in `keys/` would win without a word. Rejected.
