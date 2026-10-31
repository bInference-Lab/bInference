# @binference/spaceid

SPACE ID names: resolves a `.bnb` name to its address and reads the address's reverse record, on
chain.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- It implements the `NameResolver` port and passes `nameResolverContract` in its unit test and on
  the fork. It never signs or sends.
- The registry and the `.bnb` base registrar come only from the chain registry, by their names
  `registry` and `base-registrar`. Every name's resolver, and every reverse record's resolver, is
  read from the registry at the time of use, never assumed (decision 0306).
- A name is normalized by ENSIP-15 and hashed by EIP-137 in `src/names/`; text that does not
  normalize, or names no label before `.bnb`, is `malformed` and reads nothing.
- `src/registry/` is the one folder that knows SPACE ID's ABIs and calls the chain. One resolution
  reads the latest block, then every record at that block number, through the chain's RPC
  failover with the caller's signal. It caches nothing.
- A name is not found when its second-level registration ended by the block's time, it has no
  resolver, its resolver answers no address, or the address is zero. An address with any code,
  an EIP-7702 delegation's included, is a contract.
- A revert of the registry or the base registrar, or an answer outside its shape, is a fault
  (`spaceid.read_failed`); a resolver that reverts is no record.
- Unit tests read a SPACE ID world in `src/testing/`, never the network. The fork tests in
  `src/fork/` place names as SPACE ID's controllers and a holder place them, and run in the fork
  suite.
