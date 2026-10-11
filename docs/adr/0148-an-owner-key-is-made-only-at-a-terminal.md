# 0148. An owner key is made only at a terminal

Status: Accepted

## Context

Spec 5 section 2 step 2 shows the owner key's private half once, in the terminal only. `init` with
`--yes`, `--json` or no terminal broke that: it made the key anyway, printed its code to the
command's output, and put it in the JSON answer as `ownerKeyCode`. A container, a CI job or a
service wrapper keeps that output in its logs (`docker logs`, journald), and whoever reads them can
export every wallet and attach a machine. No decision recorded the exception.

## Decision

- `init` makes an owner key only for a person at a terminal, with the check-back. With nobody
  there it never makes one and never prints a code.
- A headless `init` takes the owner key's public half from `--owner-key-public`: DER
  SubjectPublicKeyInfo in base64, the format of `custody.privy.ownerKeyPublic`. Without it, init
  stops with `init.owner_key_needs_terminal` before anything is stored or made on Privy; a value
  that is no P-256 public key stops it with `init.bad_owner_key_public`.
- `binference owner-key create` makes the key on a machine with a terminal, such as the owner's
  laptop: it shows the code once, asks for the check-back, prints only the public half, and reads
  or writes no state folder. With `--yes`, `--json` or no terminal it makes no key.
- No JSON answer carries an owner key code.
- `init --attach` takes the owner key code at the terminal as before; with `--owner-key-public`
  it is refused (`init.attach_owner_key_public`).

Accepted by the owner on 2026-10-11.

## Consequences

- A container or service install is a two-step setup: `owner-key create` at a terminal, then
  `init --yes --owner-key-public <key>` where the engine runs.
- Scripts that read `ownerKeyCode` from `init --json` stop working; they pass the public half
  instead.
- Spec 5 section 2 and the CLI's README say so; the tests make their owner keys apart from init.

## Alternatives

- **Write the code once to a new `0600` file the owner must delete.** The code still lands on
  the headless machine's disk and in its backups, beside the agent key in `file` mode. Rejected.
- **Keep printing it and record the exception.** The logs keep the code for as long as they are
  kept. Rejected by the owner.
