# 0164. Backups are sealed to a key derived from the owner key

Status: Accepted

Accepted by the owner on 2026-10-11.

Amends [decision 0055](../DECISIONS.md#d0055).

## Context

The owner key is a P-256 key. Privy takes it for ECDSA signatures over its requests, and
[spec 5, section 7.2](../specs/keys-and-backups.md#section-7-2) sealed each backup's data key to it
with HPKE, whose DHKEM does ECDH with the same scalar. No practical attack across this pair is
known, but one key serving two primitives gives up the separation every other key of binference
keeps: a fault in one use reaches the other, and neither can be rotated alone.

## Decision

- **The sealing key.** Backups are sealed to a P-256 key pair derived from the owner key: HKDF-SHA256
  (RFC 5869) over the owner key's 32-byte private scalar, with no salt and the `info`
  `binference sealing key v1`, gives 32 bytes of keying material; RFC 9180's DeriveKeyPair for
  DHKEM(P-256, HKDF-SHA256) maps them to a valid scalar. The same owner key always derives the
  same sealing key; the sealing key reveals nothing of the owner key, and the owner key never does
  ECDH any more.
- **Format version 3.** A backup sealed to the sealing key says `version: 3` in its header, and
  its HPKE `info` is `binference-backup v3`. Version 2 files, sealed to the owner key itself, still
  open with it; a version 3 file opens with the sealing key alone.
- **The install keeps the sealing key's public half** in its custody (`custody.seal_key_public`),
  and seals every new backup to it. `binference init` keeps it when it makes the owner key at the
  terminal; `init --attach`, a rebuild and a restore keep it from the owner key they are given.
- **An install made before moves on its own.** The first time the owner key is entered after the
  update, in any request that proves it (a ceiling change, an export, a signer revoke, an attach, a
  restore), binference derives the sealing key and keeps its public half. Until then backups stay
  version 2, and `binference status` shows the `backup_key` signal as needing a look, with a line
  that says to enter the owner key once.
- Known-answer tests pin the derivation: RFC 9180's DeriveKeyPair vector, the HKDF step against
  RFC 5869 written out by hand, and the sealing key of RFC 6979's P-256 example key, worked out
  apart from the code.

## Consequences

- The owner key signs; the sealing key opens backups. A wallet export still opens with a fresh
  HPKE key pair of its own ([decision 0131](../DECISIONS.md#d0131)).
- The owner key code stays the one secret the owner keeps: the sealing key needs no backup of its
  own.
- An install whose owner key was given by its public half alone seals version 2 backups until the
  owner key is entered once.

## Alternatives

- **A second random key the owner keeps.** One more secret to write down and to lose. Rejected.
- **Derive with HKDF and take the output as the scalar.** An output at or above the curve's order
  would need a rule of its own; RFC 9180's DeriveKeyPair is that rule, written down and tested.
  Rejected.
- **Keep sealing to the owner key.** It works, and gives up key separation. Rejected.
