# 0224. Init takes each answer from its flag, then its variable, then the answers file

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

ARCHITECTURE section 24 gives onboarding a mode without prompts for Docker and VPS installs. Until
now `binference init` with nobody at the terminal took every answer from a flag. A container
image passes settings as environment variables, and a server owner keeps them in a file beside
the install script. Config spec section 3 already reads `BINFERENCE_*` variables as a config
layer, and refuses one that names no config key (`config.invalid`), so a variable that only init
reads would stop the engine from starting. The specs do not say which variables and which file
init reads, which wins, or how a refusal names an answer that came from one of them.

## Decision

- **Three layers, per answer.** Each answer comes from its flag, else its variable, else the
  answers file. `binference init --help` says so.
- **The variables** are `BINFERENCE_INIT_` plus the flag's name in capitals:
  `--privy-app-id` is `BINFERENCE_INIT_PRIVY_APP_ID`, `--accept-disclaimer` is
  `BINFERENCE_INIT_ACCEPT_DISCLAIMER` (`true`, `false`, `1` or `0`). An empty variable counts as
  unset. The config layer skips every `BINFERENCE_INIT_*` variable, so they may stay set for the
  engine. One with the prefix that answers nothing is refused (`init.unknown_variable`), so a typo
  never passes unseen.
- **The answers file** is named by `--answers <file>` or `BINFERENCE_INIT_ANSWERS`. It is one
  JSON5 object whose keys are the flags' names in camel case (`privyAppId`), with
  `acceptDisclaimer` as `true` or `false` and each secret as a secret source object, as
  `config.json5` writes it. Its `set` object holds config keys by their dotted path, as `--set`
  does; the file's keys come first, so a `--set` flag wins. A key it does not know, a file that
  is gone or does not parse is refused (`init.answers_invalid`, `init.answers_missing`), naming
  the file and the key, or the line and column, never a value.
- **What stays a flag:** `--yes`, `--json`, `--start-over`, `--attach` and `--restore` decide how
  init runs, not what it answers, and have no variable or file key.
- **Refusals name the answer where it came from:** the flag, the variable, or the file's key and
  the file. A refusal never shows the value, which may be a secret typed in the wrong place.

## Consequences

- A Docker image sets up from `docker run -e BINFERENCE_INIT_...`, and a server from one file it
  keeps beside the install, with the same answers a person types.
- The same answer in two layers is never an error: the higher layer wins, as config layers do.
- The `BINFERENCE_INIT_` prefix is closed to config keys: no config key may start with `init`.

## Alternatives

- **Variables that are config keys,** such as `BINFERENCE_CUSTODY__PRIVY__APP_ID`. The rescue
  address and the disclaimer are no config keys, so init would need a second scheme anyway.
- **The answers file as a first `config.json5`.** It would mix answers init checks and stores
  elsewhere, such as the rescue address, with the config file's own keys.
- **Refuse the same answer in two layers.** A container image that sets a default variable could
  never be overridden on the command line.
