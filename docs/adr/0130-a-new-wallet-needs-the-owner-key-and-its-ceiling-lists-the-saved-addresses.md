# 0130. A new wallet needs the owner key and its ceiling lists the saved addresses

Status: Accepted

## Context

[Spec 5, section 2](../specs/keys-and-backups.md#section-2) says more wallets
(`binference wallet create`) need the owner key again. Privy asks no authorization signature to
make a key quorum, a policy or a wallet, so the key is not needed to make one: only every later
change to it. Since [decision 0091](../DECISIONS.md#d0091) a ceiling lets a send pay only the
rescue address and the addresses saved with the owner key, and since
[decision 0110](../DECISIONS.md#d0110) the owner key signs ahead the ceiling changes of a new
rescue address that waits. `wallet/create` is an owner-key operation over IPC only. Nothing said
what a new wallet's ceiling lists, or how it joins a rescue address change under way. The owner
decided on 2026-10-10.

## Decision

- `wallet/create` takes the owner key code, over IPC only. `binference wallet create` asks for
  it with hidden input; no flag takes it. Custody checks the code against the install's owner
  key before it makes anything, though Privy needs no signature: `wallet.bad_owner_key`
  otherwise.
- The new wallet is owned by the owner key, with this machine's agent key as its one signer,
  under a ceiling of its own built as `binference init` builds the first one: on each enabled
  chain, the registry contracts of the agent's venues in effect and the per-transaction cap of
  `defaults.ceiling.perTxBnb`.
- Its send rules list the rescue address in effect, a new one that waits, and the agent's
  addresses saved with the owner key. With no rescue address it is not made:
  `rescue.no_address`.
- While a new rescue address waits, the owner key signs that change's two ceiling changes again,
  over every live wallet's ceiling, the new one too, and the engine keeps the new pair in place of
  the old. Saving an address with the owner key does the same.
- Custody reads the wallet back and signs for it at once; the engine stores it beside the agent's
  other wallets, journaled as a config change.

## Consequences

- A stolen CLI token or a shell without the owner key cannot add a wallet, so no new ceiling
  appears that the owner did not make.
- A new wallet can pay, at once, every address the agent's other wallets can pay, and no other.
- A new rescue address takes effect in every ceiling at its time, the new wallet's too, with no
  `notice.ceilingOutdated`.
- The install store gains a write that adds one wallet and one that replaces the kept ceiling
  changes; custody gains a port that makes a wallet.

## Alternatives

- **Make a wallet with the app secret alone.** Privy allows it, but anyone with a shell and the
  CLI token could add a ceiling. Rejected by the owner.
- **Start a new wallet's ceiling with the rescue address alone.** A send to a saved address would
  pass the engine's policy and fail at Privy. Rejected.
- **Refuse a new wallet or a saved address while a rescue address waits.** The owner would wait a
  day for an unrelated change. Rejected.
- **Leave the kept changes as they were.** Custody would refuse them once due, the old rescue
  address would stay in the ceilings, and the owner would have to set it again. Rejected.
