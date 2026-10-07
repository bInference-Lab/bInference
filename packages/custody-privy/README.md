# @binference/custody-privy

## Purpose

Custody through the owner's own Privy app (keys spec, sections 1, 2 and 4). It builds each
wallet's ceiling as a Privy policy, from the registry's contracts for the enabled venues, the
registry's spenders, the rescue and saved addresses and the cap per transaction. Privy refuses any
signature outside the ceiling, whatever the machine asks.

## API

| Export                                      | What it does                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `buildCeiling`, `CeilingRequest`, `Ceiling` | The ceiling of spec 5, section 4 as Privy rules for `eth_signTransaction`    |
| `registryCeilingChain`                      | One chain's contracts and spenders for the enabled venues, from the registry |
| `PolicyRule`, `policyRuleJson`              | A rule in Privy's policy language, and its JSON                              |
| `signaturePayload`, `PrivyRequest`          | The RFC 8785 text an authorization signature signs                           |
| `@binference/custody-privy/testing`         | The Privy fake and the fixtures of the ceiling tests                         |

## The ceiling

On each enabled chain: calls to the listed contracts with at most the cap in native coin (1 BNB by
default); an `approve` to a registry spender with no coin; a native send or a token `transfer` to
the rescue address or a saved address; a zero-value transfer to the wallet itself, which cancels a
stuck transaction. `setApprovalForAll` is denied everywhere. The owner, never a signer, may export
the key. Privy denies every other request and every other method.

## Example

```ts
import { buildCeiling, registryCeilingChain } from "@binference/custody-privy";

const bsc = registryCeilingChain({ definition, venues, perTxNativeCapBase: 10n ** 18n });
if (!bsc.ok) {
  return bsc; // "unknown_contract": a venue names a contract the registry does not hold
}
const ceiling = buildCeiling({ chains: [bsc.value], rescue, saved: [] });
```
