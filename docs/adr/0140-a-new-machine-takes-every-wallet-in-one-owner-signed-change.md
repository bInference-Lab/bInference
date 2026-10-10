# 0140. A new machine takes every wallet in one owner-signed change

Status: Accepted

## Context

Spec 5, section 6 says `binference init --attach` makes a new agent key, adds it as each wallet's
signer and removes the old one, all signed with the owner key, and that `binference signer revoke`
removes a machine's agent key from any other machine. The protocol has `signer/revoke`
`{ signer, ownerKey }`. The spec leaves open how the change reaches Privy, what a revoke refuses,
and what the machine whose key was removed does next.

Privy changes a wallet's added signers with `PATCH /v1/wallets/<id>`, which the wallet's owner
signs; the list sent replaces the one the wallet had. Changing a key quorum's own keys needs that
quorum's signature, which a lost machine cannot give. Two engines that sign for one wallet race on
its nonces ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)). Two programs that poll one
bot token stop each other: Telegram answers the older poll with 409.

## Decision

- **Attach.** `binference init --attach` runs under the engine lock on a folder that holds the
  install: its `engine.sqlite` and `config.json5`. It checks the config and the Privy app (the
  app id must be the custody's; a secret this machine does not hold where config names it is asked
  for, hidden, and kept there), asks the owner key code with hidden input, 3 tries, never a flag,
  and refuses a code whose public half is not the install's owner key before Privy hears of it.
  Then it makes the agent key from the OS CSPRNG where the unlock mode keeps it, or keeps a key an
  earlier attach left there, and refuses a machine that holds the wallets' key already.
- On Privy, attach makes a key quorum for the key, and for each live wallet sends one change the
  owner key signs, expiring in 5 minutes, that makes the new quorum the wallet's one added signer,
  bound to the wallet's ceiling. The old signer leaves in the same change, so no wallet ever takes
  two machines' signatures. Each wallet is read back: owner and policy unchanged, the signer
  exactly the new one. A refusal stops at that wallet; the same attach again goes on.
- `engine.sqlite` then records, in one transaction, the custody's agent key quorum, its public
  half and when it attached, and every live wallet's signer. Attach prints this machine's signer
  ID and the signers it removed, and the next steps: `binference stop` on the old machine, then
  `binference start` and `binference telegram pair` here.
- **Revoke.** `signer/revoke` (admin, IPC only, owner key) removes a key quorum from every live
  wallet that lists it, keeping the others, read first and read back. It refuses this engine's own
  key (`signer.own_key`), a signer no live wallet lists (`signer.not_found`), and a signer a wallet
  lists alone (`signer.last_signer`); each changes nothing. A removal is announced as
  `notice.signerRevoked`.
- **The machine whose key was removed.** At each start and `binference unlock`, once Privy accepts
  the app, the engine reads every live wallet from Privy; a wallet that no longer lists this
  machine's key quorum leaves the engine locked with a new reason, `signer_revoked`, which
  `binference unlock` does not clear. Such an engine never signs and does not start the owner's
  bot, so the machine that took its place keeps it. Its background service still starts it at
  each login, locked, until the owner stops it there; a command that removes the service is
  proposed apart.
- Archived wallets keep their signers: the owner key of an earlier setup owns them.

## Consequences

- Each start and unlock reads every live wallet from Privy once, one at a time.
- An engine still running on the old machine polls the bot until it stops or restarts; while both
  poll, Telegram stops one of them (`telegram.polling_stopped`). The owner stops the old machine
  first, which attach says.
- An attach that stopped part way leaves some wallets on the new key and the rest on the old one.
  The old engine stays locked at its next start, and the same attach again finishes the move.
- A machine attached by mistake is undone by attaching the right one, since a revoke never
  removes a wallet's last signer.
- Spec 5, section 6, the protocol spec, spec 4's notices and the lock reasons gain these words, in
  English and Chinese.

## Alternatives

- **Add the new signer, then remove the old one.** Two owner-signed changes per wallet, and a
  window in which both machines sign and race on nonces. Rejected.
- **Put the new key into the agent key quorum.** Privy asks that quorum's own signature, which a
  lost machine cannot give. Rejected.
- **Let a revoke remove a wallet's last signer, or this engine's own key.** A wallet with no
  signer can neither trade nor rescue until a machine attaches, and an engine that revoked its own
  key would run on unable to sign. A freeze or Privy's dashboard stops a machine at once instead.
  Rejected.
- **Let the old machine learn of the removal only when Privy refuses its next signature.** It
  would show as unlocked and keep taking the bot from the new machine. Rejected.
