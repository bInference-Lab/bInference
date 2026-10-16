# 0223. Init with nobody at a terminal accepts the disclaimer by a flag that prints it

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

Spec 4 section 9 says `binference init --yes` prints the disclaimer and needs its explicit flag.
[Decision 0220](../DECISIONS.md#d0220) stores an acceptance only when a person types the phrase,
and [decision 0222](../DECISIONS.md#d0222) leaves the disclaimer unaccepted in a run nobody
answers, so an install set up in a container or on a server always meets the phrase at
`binference live`, and `binference live` refuses without a terminal. The specs do not name the
flag, say what it prints, where the text goes beside a JSON answer, or what a person at the
terminal does with it.

## Decision

- **The flag** is `--accept-disclaimer`. It counts only in a run nobody answers (`--yes`,
  `--json` or no terminal). A person at the terminal types the phrase, flag or not.
- **It prints first.** Before it accepts, init prints the disclaimer and the privacy statement in
  full, in the run's language, then a line that says both were accepted. With `--json` the texts
  go to standard error, so standard output keeps one JSON answer.
- **It stores** the current version and the time, as a typed phrase does, and the answer says
  `disclaimer: "accepted"`. An install that accepted the current version before is told so, and
  nothing is printed again.
- **Without the flag** nothing changes: no acceptance is stored, and the run says that
  `binference live` shows the texts, and that the flag accepts them during init.
- The flag accepts the version this binference prints. A later version asks again at
  `binference live`, as decision 0220 says.

## Consequences

- A Docker or server install can go live from its first start, and its logs hold the text it
  accepted.
- A script that passes the flag accepts on its owner's behalf; the printed text is the record of
  what was accepted.
- Amends decisions 0220 and 0222: a run nobody answers stores an acceptance when the flag is
  given.

## Alternatives

- **A flag that carries the version, such as `--accept-disclaimer 2`.** A script would break at
  every new text without proving anyone read it; the printed text and `binference live` already
  ask again for a new version.
- **Accept with `--yes` alone.** `--yes` answers every question, so the owner would accept terms
  without one explicit step for them, which spec 4 section 9 forbids.
- **Print only a link to the text.** The run's output would not show what was accepted.
