# 0390. A config key may name a credential stored in the engine

Status: Accepted

Accepted by the lead on 2026-11-07. Amends [decision 0388](../DECISIONS.md#d0388).

## Context

Decision 0388 keeps the owner's credentials in `engine.sqlite`, where the agent's requests and
`binference credential set` put them, and no read gives a value back. An owner who stored a
provider's key that way still has to put the same key in the keychain, a file or a variable before
`config.json5` can use it: a model key, a venue's key or the bot's token. Two copies of one secret
drift apart, and the second is one more place it can leak from.

## Decision

- A secret source may be `{ fromCredential: "NAME" }`, the name of a stored credential, beside
  `fromKeychain`, `fromEnv`, `fromFile` and `fromCommand`. `binference config set <key>
--from-credential <name>` writes it. Config migration 18 to 19 records the new form; no file
  changes.
- Only the running engine reads it. `CredentialStore` gains `reveal`, the one read that gives a
  value back, as a `Secret`; only the composition root calls it, for a config key that names the
  credential. Anywhere else (`binference init`, `check`, the unlock keys) a credential source is
  `config.secret_unavailable` with the reason `engine_only`, and the agent key and the Privy app
  secret never come from one.
- The engine opens `engine.sqlite` before it reads the config's secret sources, so a key read at
  start, such as the bot's token or a model key, may name a credential. The store's own start
  reads no secret.
- A credential named in config is sent wherever that config key sends it: the owner wrote the
  config, so its hosts bind only what the agent's own commands may do with it.

## Consequences

- One stored copy serves both the agent's requests and the config.
- A store that does not open now stops the start before any secret is read, as it stopped it
  before any part that needs one.
- Deleting a credential a config key names makes that key unreadable at the next start; the part
  that needs it reports `config.secret_unavailable` as for any missing secret.

## Alternatives

- **Copy the credential into the keychain when the owner stores it.** Two copies, and a removal
  would have to reach both.
- **Hold the config's keys to the credential's hosts.** The owner chose where the config sends a
  key when they wrote it; the hosts guard what the agent does.
