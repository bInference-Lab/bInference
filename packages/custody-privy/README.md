# @binference/custody-privy

## Purpose

Custody through the owner's own Privy app (keys spec, sections 1, 2 and 4). It builds each
wallet's ceiling as a Privy policy, makes the key quorums of the owner and agent keys, makes agent
wallets owned by the owner key with the agent key as their one signer bound to the ceiling, reads
each new wallet back before anything signs for it, and signs transactions with
`eth_signTransaction`, each request authorized by the signer with the agent key. Privy refuses any
signature outside the ceiling, whatever the machine asks.

The signer is reached through the `SignerProcess` port of `@binference/chain`, with chain's
`AuthorizeInput`: the engine's `SignRequest`, the Privy wallet and the exact request the SDK sends.
The bytes the SDK signs must be the bytes chain's `authorizationPayload` writes for that request.

## API

| Export                                       | What it does                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `buildCeiling`, `CeilingRequest`, `Ceiling`  | The ceiling of spec 5, section 4 as Privy rules for `eth_signTransaction`         |
| `registryCeilingChain`                       | One chain's declared calls and spenders for the enabled venues, from the registry |
| `createDayCaps`, `ChainCapPlan`, `ChainCaps` | Makes the aggregations of a chain's 24-hour caps, owned by the owner key's quorum |
| `PolicyRule`, `policyRuleJson`               | A rule in Privy's policy language, and its JSON                                   |
| `createPrivyApi`, `PrivyApi`                 | Privy's API for one app through its Node SDK: quorums, policies, wallets, signing |
| `privyApiOrigin`                             | Privy's API origin, which the signer's settings name                              |
| `checkPrivyApp`                              | Checks an app's id and secret with one read: a page of one Ethereum wallet        |
| `createAgentWallet`                          | Makes the policy and the wallet, then reads the wallet back                       |
| `readBackWallet`, `checkWallet`              | Checks a wallet's owner, signer and policy against what was asked                 |
| `createPrivyOwnerSigner`                     | The `privy-owner` adapter of the chain `Signer` port                              |
| `@binference/custody-privy/testing`          | The Privy fake, a fake signer, the custody contract and its fixtures              |

## The ceiling

On each enabled chain (decision 0149): each function the enabled venues declare, by
`function_name`, on the contracts that declare it, with at most the cap in native coin (1 BNB by
default) and its pinned inputs the wallet itself, while the native coin sent in 24 hours stays
within the chain's cap; an `approve` to a declared spender with no coin, while each capped token's
approvals in 24 hours stay within its cap; a native send or a token `transfer` to the rescue address
or a saved address; a zero-value transfer to the wallet itself, which cancels a stuck transaction.
`setApprovalForAll` is allowed nowhere. The owner, never a signer, may export the key. Privy denies
every other request and every other method.

The 24-hour caps are Privy aggregations, which the app sums over every wallet that names them.
Privy's Node SDK has no aggregation call, so `createDayCaps` sends `POST /v1/aggregations` itself,
with the app's Basic auth, through the `Http` port.

## Example

```ts
import {
  buildCeiling,
  createAgentWallet,
  createDayCaps,
  createPrivyApi,
} from "@binference/custody-privy";

const api = createPrivyApi({ http, clock, appId, appSecret });
const owner = await api.createKeyQuorum(
  { publicKey: ownerKeyPublic, displayName: "owner" },
  { signal },
);
const caps = await createDayCaps(api, { plans: [bscCaps], owner: owner.id }, { signal });
const ceiling = caps.ok
  ? buildCeiling({ chains: [{ ...bscCeiling, caps: caps.value[0] }], rescue, saved: [] })
  : caps;
if (!ceiling.ok) {
  return ceiling;
}
const agent = await api.createKeyQuorum(
  { publicKey: agentKeyPublic, displayName: "agent" },
  { signal },
);
const wallet = await createAgentWallet(
  api,
  {
    ownerQuorum: owner.id,
    signerQuorum: agent.id,
    expected: { ownerKey: ownerKeyPublic, agentKey: agentKeyPublic, ceiling: ceiling.value },
  },
  { signal },
);
if (!wallet.ok) {
  return wallet; // "owner", "signer" or "policy": Privy holds something else than was asked
}
```
