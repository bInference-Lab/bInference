# 0335. An identity registers once, from the owner's surfaces, and is stored once read back

Status: Accepted

Accepted by the owner on 2026-11-02.

## Context

Spec 1 (section 7.9) makes `identity/register` store a `registerIdentity` intent whose one step
registers the agent in the ERC-8004 identity registry the chain registry lists; a paper agent's
ends `rejected_policy` with `paper_only`, and an agent that has a registration fails
`intent.identity_exists`, storing nothing. Spec 6 gives it a 10-minute card. The operation's scope
is `propose`, which the agent runtime and MCP clients hold.

The BSC registry is `IdentityRegistryUpgradeable` 2.0.0 behind a proxy a 3-of-5 Safe can upgrade
(read on chain 2026-10-06; `getVersion()` still "2.0.0" on 2026-11-02). `register(string agentURI)`
mints an ERC-721 token to the caller, stores the caller as the token's `agentWallet`, and emits
`Registered(agentId, agentURI, owner)`. Nothing in the contract stops one wallet from registering
twice. The ceiling allows that one call on the registry, declared under the venue `erc8004`
([decision 0304](0304-the-signer-refuses-an-approval-sent-to-the-identity-registry.md)), but no
core venue declares it yet, so no wallet's ceiling holds it.

What the specs leave open: who may start a registration, how "already registered" is known, what
holds the registry to the version binference was tested with, what an older ceiling does, and
when the registration counts as made.

## Decision

- **The owner starts it.** As with a token launch
  ([decision 0236](0236-only-the-owner-starts-a-token-launch-with-a-picture-of-their-own.md)), a
  registration publishes words for good, so `identity/register` from the agent runtime or an MCP
  client fails `intent.owner_only`, storing nothing. The CLI, the console and the Mini App may
  start one; every one opens a card that auto mode never skips.
- **The wallet.** The agent's live main wallet on the chain whose registry the chain registry
  lists signs the one step, value 0. The identity token is minted to it.
- **Once per agent.** The engine refuses with `intent.identity_exists`, storing nothing, when the
  store holds the agent's registration, or when the registry's `balanceOf` reads that the wallet
  holds an identity token already, such as one made before a rebuild or outside binference. When
  the wallet queue takes the confirmed step, `balanceOf` is read again, and a token found ends the
  intent `failed_check` with the new reason `identity_exists`.
- **The version binference was tested with.** The registry's `getVersion()` must answer "2.0.0"
  at the quote and again at the queue take; any other answer ends the intent `failed_check` with
  the new reason `registry_changed`, before the card or before the signature. A new version joins
  the plugin after a fork test.
- **The ceiling, by the owner's opt-in.** The `erc8004` venue is no core venue, so no wallet's
  ceiling allows `register(string)` until its owner opts the agent in. `identity/allow`, with the
  owner key over IPC, writes the registry's one call into the ceiling of the agent's main wallet
  and no other wallet's, read back, journaled and announced as `ceiling/set` is; a ceiling that
  holds the call already is left as it is. `binference agent identity` runs it before it proposes
  a live agent's registration. A registration whose main wallet's stored ceiling lacks the call
  ends `failed_check` with the new reason `identity_ceiling` before the card; its words name
  `binference agent identity`. Once binference holds the agent's identity, a ceiling planned
  again for it, by `ceiling/set` or a destination save, leaves the registry out.
- **The policy.** `paper_only` in paper mode and `frozen` for a frozen agent, as spec 6 orders
  them. No venue rule judges a registration: the opt-in is the owner key's write, not a 24-hour
  loosening of the agent's limits. The step moves no funds, so it stores no value and counts against neither cap, as an
  approval revoke does; its gas leaves the wallet as a departure.
- **The host holds the plugin.** The engine reaches the registry only through an `IdentityRegistry`
  port of `@binference/chain`, which `plugins/erc8004` implements, with a contract suite and a
  fake. The host copies every answer through schemas, and decodes the built call before the card
  and again before the signature: the registry the chain registry lists, `register(string)`,
  value 0, and the exact file the card shows; anything else is `decode_mismatch` with the check
  `other_identity`. The simulation holds that only gas leaves and that one identity token of the
  registry arrives in the wallet.
- **Stored once read back.** The registration is made once its step is final and the registry
  reads it back: the receipt's `Registered` event from the registry, naming the wallet as owner,
  gives the id; `ownerOf(id)` reads the wallet and `tokenURI(id)` the card's file. Then one write
  stores the `identities` row (engine migration 0058) and moves the intent to `reconciled`, with
  `receipt.identity` naming the id. A read that fails, a node that holds no receipt yet among
  them, is tried again each block up to
  `settleAfterBlocks`, then the intent stays `finalized` and recovery tries again. A read that
  differs, a read receipt that reverted or holds no `Registered` event naming the wallet among
  them, is logged as `executor.identity_mismatch`, stores no row, and tells the owner with
  `notice.identityMismatch`. `identity/get` answers the stored row.

## Consequences

- The engine opens a registration only from the owner's surfaces, never from content the agent
  read, and only for an agent whose owner opted in.
- The ceiling is the bound under a stolen engine key. An agent that never opted in has no rule
  that lets such a key register it, and an agent that registered loses the rule at its next
  rewrite. Between the opt-in and the registration, and after it until that rewrite, a stolen key
  could publish one registration with its own text, tied to the owner's wallet for good, for gas
  alone. The opt-in right before the card keeps that window short.
- A wallet registered outside binference cannot register again, and `identity/get` shows nothing
  for it, since binference does not search the registry's history for its id.
- An upgrade of the registry stops new registrations until binference tests and accepts its
  version.
- Spec 1 section 7.9 gains the owner-only rule, `file` in `identity/get`'s result and
  `description` in the request; spec 6 gains `identity_exists` and `registry_changed`; the
  glossary gains `notice.identityMismatch`.
- An agent registers by `binference agent identity` alone, whatever its wallets' age: the opt-in
  writes the call the registration needs.

## Alternatives

- **Make the registry a core venue.** Every main wallet's ceiling would allow `register(string)`
  with any file, so a stolen engine key could publish words for any agent, opted in or not. Lost
  to the opt-in.
- **Judge a registration by the agent's venues.** Adding `erc8004` to the agent's limits is a
  loosening, which waits 24 hours, and the owner key's write is the stronger opt-in. Lost.

- **Let the agent propose a registration with its own description.** The card shows every field,
  but a description from a turn that read outside content would be published for good on one tap.
  Lost to the owner-only rule launches already follow.
- **Know a registration from the store alone.** A rebuild loses the store's row while the token
  stays, and a second register mints a second identity. Lost.
- **Search the registry's `Registered` events for the wallet.** It needs a log query from the
  registry's first block, millions of blocks on BSC. Lost; `balanceOf` answers the only question
  the refusal needs.
- **Trust the registry's version.** A Safe can upgrade it; an unread upgrade could change what
  `register` does with the caller. Lost.
- **Store the registration from the receipt alone.** It never checks that the token stayed with
  the wallet and holds the tapped file. Lost.
