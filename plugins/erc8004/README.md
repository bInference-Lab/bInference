# @binference/erc8004

## Purpose

The agent identity registry of ERC-8004. An owner may register an agent there once, with one
tapped transaction: the registry mints an identity token to the agent's main wallet and keeps the
agent's registration file, which anyone can read.

- **File.** ERC-8004's `registration-v1` JSON as a base64 `data:` URI: the agent's name, the
  owner's description, the registering wallet as a CAIP-10 account, and binference's release
  version, with no picture, endpoint or trust model.
- **Read.** At the latest block, the registry's version and how many identity tokens a wallet
  holds; after a registration lands, the id its `Registered` event gave, who holds it and the file
  the registry keeps for it.
- **Build.** `register(string)` from the wallet with no coin, and a decoder that reads back only
  that call.
- **Faults.** No node answering is the RPC failover's `chain.rpc_down`; a view that reverts or
  answers outside its shape is `erc8004.read_failed`; a missing or foreign registry at creation is
  `erc8004.bad_options`, a wallet of another chain `erc8004.bad_request`.

## API

| Export                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `createErc8004Registry` | The identity registry over a chain's RPC failover               |
| `erc8004Declaration`    | The registry and its one call, as a ceiling holds them          |
| `erc8004Id`             | The plugin's id, `erc8004`                                      |
| `erc8004TestedVersion`  | The registry version the plugin was tested with                 |
| `identityRegistryName`  | The registry's name in the chain registry                       |
| `Erc8004Options`        | The chain, its RPC failover and the registry's ERC-8004 entries |

## Example

The composition root builds the registry for the chain whose registry lists it:

```ts
import { createErc8004Registry } from "@binference/erc8004";

const registry = createErc8004Registry({ chain, rpc, contracts });
const { version, held } = await registry.standing(wallet, { signal });
```
