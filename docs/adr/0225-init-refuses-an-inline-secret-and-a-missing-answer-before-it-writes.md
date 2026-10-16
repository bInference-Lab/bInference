# 0225. Init refuses an inline secret and a missing answer before it writes

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Decision 0224](../DECISIONS.md#d0224) lets init's answers come from flags, `BINFERENCE_INIT_*`
variables and an answers file. Config spec section 5 allows a secret in config only as a secret
source, and section 4 refuses one written as plain text with `config.secret_inline`. Init took a
secret answer as a source too, but called plain text "no secret source" (`init.bad_source`), and
it found a missing answer only at the step that needed it, after it had made the state folder and
`engine.sqlite`. A container that restarts a failed init found a half-made folder, and a script
read neither which variable nor which file key to set.

## Decision

- **A secret answer is a source, never the secret.** The Privy app secret, the bot token and the
  model key from a flag, a variable or the answers file must be a secret source object. Text that
  is not an object is the secret itself, or text that holds it, and init refuses it with
  `config.secret_inline`. The refusal names the answer where it came from and shows a source to
  use, such as `{ fromEnv: "BOT_TOKEN" }`; it never shows the text, and it says to replace a real
  secret where it was issued, since a flag's text stays in the shell's history. An object that is
  no secret source stays `init.bad_source`.
- **A `set` key that holds a secret as text** fails the config check with `config.secret_inline`
  as well, in place of `config.invalid`, and its message names the key only.
- **A new set-up nobody answers is checked before anything is written:** inline secrets first,
  then each answer it needs, in the order of the onboarding: the Privy app ID and secret, the
  owner key's public half, the rescue address, the bot token, and the program of the `command`
  unlock mode. The first one missing is refused with `init.needs_flag`, naming its flag, its
  variable and its answers file key; a missing owner key's public half keeps its own refusal
  ([decision 0148](../DECISIONS.md#d0148)). The run exits 1 with nothing in the state folder and
  no call to Privy.
- Values are checked where they were before: the steps still refuse a bad address or ID, by the
  name of the layer that gave it.

## Consequences

- A container or a script learns everything it lacks from one refusal at a time, before any
  state exists to clean up.
- A secret pasted by mistake into a flag, a variable or the file never reaches config, a log or
  an error; the owner is told to replace it.
- `init.bad_source` now means only an object that is no secret source.

## Alternatives

- **Take a secret as plain text and store it as a person's typed one is stored.** Variables and
  files leak through process listings, logs and backups, and config spec section 5 forbids it.
- **Name every missing answer at once.** Some answers depend on others, such as the unlock
  program on the mode, so the first missing answer is the one that holds for sure.
- **Check at each step, as before.** The state folder and the database would exist before a
  missing answer stops init.
