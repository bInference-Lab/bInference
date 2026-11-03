# @binference/erc8004

The ERC-8004 agent identity registry: writes an agent's registration file, reads a wallet's
standing, and builds the one register call that mints the identity to the wallet that signs.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin ([decisions 0334](../../docs/adr/0334-a-registration-file-holds-the-agent-s-name-the-owner-s-words-its-wallet-and-the-version.md)
and [0335](../../docs/adr/0335-an-identity-registers-once-from-the-owner-s-surfaces-and-is-stored-once-read-back.md)):

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- It implements the `IdentityRegistry` port through `defineIdentity` and passes
  `identityRegistryContract` in its unit test and on the fork. It never signs or sends.
- The registry comes only from the chain registry, by its name `identity-registry`. ERC-8004 ships
  no SDK binference uses; every function and event comes from the reference registry,
  `IdentityRegistryUpgradeable.sol` 2.0.0 of erc-8004/erc-8004-contracts, which BSC's registry
  runs. `erc8004TestedVersion` is the version a fork test passed on; a new one joins only after
  that test passes on it.
- It declares `register(string)` on the registry and nothing else, no spender, and marks the
  registry as a contract no approval is sent to (decision 0304): the registry's
  `bscVenueCalls.erc8004` holds the same call, and the composition root's test checks the two
  agree. The overloads that take metadata or no URI are never built.
- The decoder reads only `register(string)` to the registry on its chain, with no coin, in the
  exact bytes the builder writes; anything else is `unknown_call`. The registry mints to the
  caller, so the call credits the wallet that signs alone.
- The registration file (`src/file/`) is ERC-8004's `registration-v1` JSON, compact, as a base64
  `data:` URI, with the fields decision 0334 sets and no others: one `wallet` service naming the
  registering wallet and one `binference` service carrying the release version.
- `src/registry/` reads the chain: the version, a wallet's balance of identity tokens and the
  proxy's EIP-1967 implementation slot at one latest block, the implementation held to the one
  the chain registry pins as `identity-registry-implementation`, and a landed registration from its own `Registered` event, then the holder and the
  file at the latest block. A view that reverts, an answer outside its shape, or a node that holds
  no receipt of the transaction yet is `erc8004.read_failed`, so the caller reads again. It caches
  nothing.
- Unit tests read a registry world in `src/testing/`, never the network. The fork test in
  `src/fork/` registers from anvil's account on the pinned BSC fork and reads it back.
