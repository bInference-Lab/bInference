# 0306. A .bnb name resolves through SPACE ID's registry at one block, and any code refuses it

Status: Proposed

## Context

A send may name a `.bnb` name (decision 0071). Spec 1, section 7.3 says the engine normalizes it
as SPACE ID does, reads SPACE ID's registry and the name's resolver at the latest block on every
call, answers the address and what its reverse record names, and refuses a name with no resolver,
no address record, the zero address or an expired registration (`name.not_found`), and an
address that holds code (`name.contract`). Spec 6 reads the name again when the wallet queue takes
the send. The specs leave open how the client is built and how each rule is read on chain:

- SPACE ID's docs list no BSC contracts. Its SDK, `@web3-name-sdk/core` 0.4.2, names the `.bnb`
  base registrar and a hub on Ethereum that names the registry; both were read on chain. The SDK
  normalizes with `@adraffy/ens-normalize` (ENSIP-15), sends its own RPC requests through viem,
  and declares peer dependencies on Solana, Sei and Injective SDKs.
- Resolvers differ per name: the registry names each one, and only the registry and the base
  registrar are fixed.
- The base registrar keeps an expired name's registry record for a grace period of 90 days
  (`GRACE_PERIOD()` 7,776,000 s), and its resolver still answers then.
- SPACE ID's own address delegates its code by EIP-7702 (`0xef0100` and a delegate's address, read
  2026-10-31), so it holds code.

## Decision

- `plugins/spaceid` reads SPACE ID's contracts through the chain's RPC failover, which gives each
  read its timeout per endpoint and the caller's signal. It takes the registry and the base
  registrar from the chain registry by name and caches nothing.
- A name is normalized by ENSIP-15 (viem's `normalize`, the same algorithm as the SDK's) and hashed
  by EIP-137's namehash. It must end in `.bnb` with at least one label before it.
- One resolution reads the latest block's number and time, then reads every record at that block
  number: the base registrar's `nameExpires` of the second-level label, the registry's
  `resolver(node)`, that resolver's `addr(node)`, the address's code, and its reverse record
  through the resolver the registry names for `<address>.addr.reverse`.
- The name is not found when its registration ended at or before the block's time (the grace
  period counts as ended), the registry names no resolver, the resolver reverts or answers no
  address, or the address is zero. A subname ends with its second-level name.
- Any code at the address refuses the name as a contract, a delegation's code included.
- The reverse record `matches` when its text normalizes to the name, `differs` with its own text
  otherwise, and is `none` with no resolver or an empty name. A reverse resolver that reverts or
  answers outside its shape leaves `reverse` out; the name still resolves.
- A revert of the registry or the base registrar, or an answer outside their shape, is a fault
  (`spaceid.read_failed`). The engine answers any fault as `name.resolver_down`.
- The resolver is the `NameResolver` port of `@binference/chain`, chosen by its suffix, so the
  engine names no naming service. The send path reads the name again with `recheckName`.

## Consequences

- `spaceid.bnb` and every name whose owner's wallet delegates by EIP-7702 is refused with
  `name.contract`. An owner ruling may later allow a delegation's code; it would be a new ADR.
- A resolution takes seven reads, two of them at once. The engine's answer for a name is never
  older than the block it read.
- A name in its grace period answers `name.not_found`, though other apps may still resolve it.

## Alternatives

- **SPACE ID's SDK.** Its requests would bypass the RPC failover and its timeouts, and it pulls
  three other chains' SDKs as peers. Lost.
- **Read the base registrar from the registry at each call.** It trusts the same registry and adds
  a read. Lost.
- **Resolve a name in its grace period.** The spec counts it as expired, and its holder may lose it
  at any time. Lost.
- **Treat a delegation's code as a person's account.** A delegated account still answers to its
  key, but the spec and the owner's rule refuse an address with code. Left to the owner.
