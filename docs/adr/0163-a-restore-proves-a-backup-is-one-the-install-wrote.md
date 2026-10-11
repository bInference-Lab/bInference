# 0163. A restore proves a backup is one the install wrote

Status: Accepted

Accepted by the owner on 2026-10-11.

Amends [decision 0142](0142-a-new-machine-receives-the-install-from-a-sealed-backup.md).

## Context

A backup's data key is sealed with HPKE in base mode to a public key the install holds
([spec 5, section 7.2](../specs/keys-and-backups.md#section-7-2)). The machine seals backups
unattended, without the owner key, so the seal says who may open a file and nothing about who
wrote it. Anyone who knows the public half (it sits in `engine.sqlite` and in Privy's key quorums)
can write a file that opens with the owner key: an `engine.sqlite` with a console device of their
own, auto mode on and high limits, and a `config.json5` with their RPC endpoints, dropped into
`backups.copyTo` under the newest backup's name. The restore's checks against Privy pass, since the
app, the wallets and the signer are real. The restore also migrated the file's SQLite database
before any check.

## Decision

- **The install records each backup it writes**: the SHA-256 of the whole file and of its header
  line, in `engine.sqlite` (`backups.file_sha256`, `backups.header_sha256`), beside the record it
  kept already. The header's digest is bound into every chunk's associated data, so a body cannot
  be swapped under a recorded header without the data key.
- **A restore compares a file with those records before anything opens its databases.** Once the
  owner key opened the data key and every chunk and file checked, the restore reads the records of
  the state it would replace. A file whose header digest and file digest match one goes on.
- **Any other file needs the owner's word.** A file the install has no record of, and every file
  on a machine whose state holds no records (a new machine, an empty folder, a state that does not
  open), is shown with its install id, the time it was taken and the wallets it holds, with a
  warning that anyone who knows the owner key's public half can make such a file. It goes on only
  once the owner types the day it was taken, `yyyy-mm-dd`; anything else changes nothing. The
  check against Privy's wallets and signer still follows.
- The records travel with a restore: the backup records the restored copy lacks are carried into
  it ([decision 0162](../DECISIONS.md#d0162)), so a later restore still knows them.

## Consequences

- A file planted in `backups.copyTo` or handed over by anyone else cannot restore unnoticed on
  the install that wrote the real ones.
- A backup written before this change, and the copy of one retention removed, read as unknown and
  ask for the owner's word.
- On a new machine the owner's typed day is the only proof; the warning says what it stands for.

## Alternatives

- **Sign each backup with a key the machine holds, endorsed once by the owner key.** It would
  prove the writer on a new machine too, but it is a second machine secret to keep in every unlock
  mode (keychain, file, systemd credentials, command, manual), and in the `file` mode it would sit
  beside the agent key, where the attacker of this threat reads it as well. Rejected for now; the
  format's version leaves room for it.
- **HPKE's Auth mode with a sender key.** The same machine secret, with the same trade. Rejected.
- **Refuse every file the install did not record.** It would stop the restore a new machine
  exists for. Rejected.
