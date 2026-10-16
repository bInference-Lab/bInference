# 0220. The engine stores the accepted disclaimer, and going live carries it

Status: Amended by 0223

Accepted by the owner on 2026-10-16.

## Context

[Decision 0060](../DECISIONS.md#d0060) shows the disclaimer and the privacy statement once before
an agent goes live, and the owner types "I understand". Spec 4 section 9 shows it in
`binference init` after the language step and in `binference live` while the owner has not
accepted the current text, version 2; spec 3 keeps the version in `safety.disclaimer_version`, and
`agent/goLive` fails `agent.disclaimer` "when not ready". Until now nothing wrote that column:
`binference live` asked the phrase on every switch to live and the engine never checked it. The
specs do not say how a client tells the engine the owner accepted, what an agent live already
does, or how init stores it.

## Decision

- The install store keeps the acceptance in the `safety` row: the version as decimal text and its
  time. It keeps the newest version only; an older one never replaces it, and a setup or a start
  over keeps it.
- `agent/goLive` takes an optional `disclaimer`: the version the owner accepted by typing the
  phrase at the caller. While the store holds no acceptance of the current version, the engine
  refuses with `agent.disclaimer` unless the call carries that version, and then stores it before
  the other checks. Once stored, no call asks again until the version rises.
- The check comes before the mode: an agent live already is refused too, and stays live. So
  `binference live` asks for a newer text there as well, as spec 4 says, and changes nothing else.
- `binference live` calls first without `disclaimer`. On `agent.disclaimer` it shows both texts,
  takes the phrase in either language and any letter case, and calls again with the version. With
  `--yes`, `--json` or no terminal it refuses, as before.
- `binference init` shows the texts after the language step. A person who types the phrase gets
  it stored with the install; init with nobody at a terminal stores no acceptance, so going live
  asks later.
- The current version is a constant beside the texts in the `disclaimer` message area, which both
  the engine and the CLI read.

## Consequences

- An owner who accepted during init goes live without being asked again.
- `agent/goLive` stays `admin` over IPC only, so only a person at the engine's machine can carry
  an acceptance.
- Scripts and tests that go live through the protocol pass the current version.
- Raising the version asks every owner again, an agent live already included, while its trading
  goes on.

## Alternatives

- **A separate operation to accept the disclaimer.** One more `admin` operation for a step that
  only ever comes right before going live, and two calls to keep in order.
- **The CLI keeps the acceptance in its own file.** The engine could not refuse a switch, and a
  second client of the engine would not see it.
- **Init refuses to finish without the phrase.** A headless install, as for Docker, could never
  finish; the phrase guards going live, not setting up.
