# 0222. Init speaks the picked language and ends with the service step

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

ARCHITECTURE section 27 orders onboarding: language; the disclaimer and privacy statement;
telemetry consent; the model; the Privy app and the owner key; the rescue address; the Telegram bot
and its pairing; limits, gas reserve and send level; the service; paper mode. `binference init`
asked only the Privy app, the owner key, the rescue address, the bot and the limits, in the
language of the system or of an earlier config. Config spec section 6.6 keeps `telemetry.enabled`
off by default and says onboarding asks once, but binference sends no usage counts yet. Decision
0138 makes `binference start` install and start the background service. The specs do not say what
the language choice changes, what the telemetry question says while nothing is sent, when the
service starts, what a start over keeps, or what a run without a person does with these steps.

## Decision

- **Language first.** For a new set-up, the person picks English or Simplified Chinese, the
  system's language first. Every later question, note, refusal and line of init is in that
  language, and it is `owner.locale` in `config.json5`. A `--set owner.locale` flag answers it.
- **The disclaimer** follows, as [decision 0220](../DECISIONS.md#d0220) says.
- **Telemetry.** The person picks no or yes, no first, and init says that binference sends no
  usage counts yet and keeps the choice in `telemetry.enabled` for when it does. A
  `--set telemetry.enabled` flag answers it.
- **The model** follows, as [decision 0221](../DECISIONS.md#d0221) says, then the steps init had.
- **The service step comes last,** once init wrote the config and let go of the engine lock, since
  the engine the service starts takes that lock: a person may start binference as the background
  service now, as `binference start` does, and that command's exit code becomes init's. With
  `BINFERENCE_HOME` set, which the service does not follow, init says to run
  `binference start --foreground` instead.
- **Paper mode** closes the summary: the agent starts in paper mode, and going live means funding
  the wallet and running `binference live`, which asks for the disclaimer only when it was not
  accepted.
- **A start over** (`--start-over`) offers the earlier config's answers first: the language, the
  telemetry choice, and the model with its provider and address. Enter on the key keeps using the
  key where the earlier config names it, read and checked again, never shown. An install that
  accepted the current disclaimer is told when and not asked again.
- **A run nobody answers** (`--yes`, `--json`, no terminal) asks none of these: the language and
  telemetry come from the flags or the defaults, the disclaimer stays unaccepted so going live
  asks for it at a terminal, the service is not started, and the model comes from
  `--model-provider`, `--model`, `--model-base-url` and `--model-key` (a secret source), or none
  is linked. A run from a file and the explicit disclaimer flag follow in a later change.

## Consequences

- A Chinese-speaking owner reads every step after the first in Chinese.
- A refused set-up never starts the service, and a failed service start leaves the set-up done.
- An install set up without a person runs without a model until the owner links one.

## Alternatives

- **Ask the language after the folder checks.** The refusals of an install set up before would
  stay in the system's language, and an earlier config's language could not be offered first.
- **Start the service before the summary.** The engine would wait on init's lock, or init would
  write its last files while the engine starts.
- **Hide the telemetry question until counts exist.** The config spec asks for consent at
  onboarding, and the owner would be asked again later.
