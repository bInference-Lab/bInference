# @binference/spaceid

## Purpose

The `.bnb` name resolver. A send may name a `.bnb` name, such as `alice.bnb`, instead of an
address. The engine asks this resolver what the name points to when the card opens and again
before it signs, so a name changed between the two refuses the send.

- **Normalize.** ENSIP-15 normalization, then EIP-137's namehash, as SPACE ID hashes names.
- **Read.** The latest block, then at that block: the base registrar's expiry of the name's
  second-level label, the registry's resolver for the name, the resolver's `addr`, the address's
  code, and the address's reverse record through the resolver the registry names for it.
- **Answer.** `found` with the address, `smartAccount: true` when its only code is an EIP-7702
  delegation, and its reverse record (`matches`, `differs` with the record's text, or `none`);
  `not_found` for an expired registration, no resolver, no address or the zero address;
  `contract` for an address with any other code; `malformed` for text that is no `.bnb`
  name.
- **Faults.** No node answering is the RPC failover's `chain.rpc_down`; a registry or base
  registrar that reverts or answers outside its shape is `spaceid.read_failed`. Missing or foreign
  contracts at creation are `spaceid.bad_options`.

## API

| Export                  | What it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `createSpaceIdResolver` | The `.bnb` name resolver over a chain's RPC failover              |
| `SpaceIdOptions`        | The chain, its RPC failover and the registry's SPACE ID contracts |
| `spaceIdContractNames`  | The registry names of the contracts it reads                      |

## Example

The composition root builds the resolver for the chain whose registry lists SPACE ID:

```ts
import { createSpaceIdResolver } from "@binference/spaceid";

const names = createSpaceIdResolver({ chain, rpc, contracts });
const answer = await names.resolve("alice.bnb", { signal });
```
