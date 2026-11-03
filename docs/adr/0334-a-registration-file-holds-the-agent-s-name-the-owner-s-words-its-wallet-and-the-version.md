# 0334. A registration file holds the agent's name, the owner's words, its wallet and the version

Status: Accepted

Accepted by the owner on 2026-11-02.

## Context

[Decision 0071](../DECISIONS.md#d0071) ships an opt-in ERC-8004 identity per agent. Spec 1
(section 7.9) says its registration file holds the agent's name, a `description` of at most 280
characters in the owner's words, the addresses of its live wallets and binference's version, and
spec 4 shows every field on the card under "Public on chain for good". The file goes on chain as
a data URI and can never be changed or deleted: the ceiling allows only `register(string)` on the
registry ([decision 0304](0304-the-signer-refuses-an-approval-sent-to-the-identity-registry.md)),
not `setAgentURI`.

What the specs leave open:

- **The file's shape.** ERC-8004 (Draft, read 2026-11-02 at eips.ethereum.org/EIPS/eip-8004)
  says the file "MUST have the following structure": `type`
  (`https://eips.ethereum.org/EIPS/eip-8004#registration-v1`), `name`, `description`, `image`,
  `services` (each a `name`, an `endpoint` and an optional `version`), `x402Support`, `active`,
  `registrations` (each an `agentId` and an `agentRegistry` written `{namespace}:{chainId}:{address}`)
  and an optional `supportedTrust`. A fully on-chain file SHOULD be a base64 `data:` URI. The
  BSC registry's agent 1 uses `data:application/json;base64,`. The file has no field for
  accounts or for the software that runs the agent.
- **Which accounts.** An agent may hold live wallets of three roles: its main wallet, a launch
  wallet ([decision 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md)) and a bridge
  wallet ([decision 0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)).
  The registry already makes the registering wallet public: `register` mints the identity token to
  the caller and stores the caller as its `agentWallet`, both read by anyone
  (`IdentityRegistryUpgradeable.sol` 2.0.0, erc-8004/erc-8004-contracts). Every other address the
  file names is a new public link: a launch wallet's address ties each token it launched to the
  agent, and a bridge wallet's ties each deposit.
- **The version text.** binference's release version, such as `2026.11.2`, as `binference
--version` prints it. It stays in the file after the agent updates.
- **The agent id.** `registrations` names the id the registry gives, which only the mint decides.
  A file that names it needs a second transaction (`setAgentURI`) and a second tap.

## Decision

- **Shape.** The file is ERC-8004's `registration-v1` JSON, compact, its keys in the ERC's order,
  as a `data:application/json;base64,` URI:
  - `type`: the ERC's `registration-v1` URI;
  - `name`: the agent's name in binference, 1 to 64 characters;
  - `description`: the owner's `description`, at most 280 characters, or `""` when the owner gave
    none;
  - `image`: `""`, since binference holds no picture of an agent;
  - `services`: one `{ "name": "wallet", "endpoint": <CAIP-10 account> }` per account the file
    lists, then `{ "name": "binference", "endpoint": "https://www.npmjs.com/package/binference",
"version": <version> }`;
  - `x402Support`: `false`; `active`: `true`;
  - `registrations`: `[]`, since one transaction cannot name the id its own mint gives; the
    registry's `Registered` event and `identity/get` name it;
  - `supportedTrust`: `[]`: the ERC reads an empty list as discovery only.
- **Accounts.** The file lists the registering wallet alone: the agent's live main wallet on the
  registry's chain, which the registry already shows. A launch or bridge wallet is never listed.
- **Version.** The running binference's release version, whole, as `binference --version` prints
  it.
- **Card.** `card.identity.file` shows every value the file holds: the name, the description
  (an empty one shows as the word "none" in the owner's language), the account whole as the file
  writes it, with its chain, and the version; `card.identity.fixed` shows the parts every file
  holds whatever the card: binference's npm page, `active: true`, and the empty lists of other
  registrations and trust models. The card's terms hash binds the file's bytes, so the file the owner tapped is the file
  that goes on chain.

## Consequences

- The file adds nothing to what the registry publishes about the wallet, beyond the agent's name,
  the owner's own words and the version.
- Spec 1, section 7.9 changes "the addresses of its live wallets" to "the address of the wallet
  that registers it", and spec 4's `card.identity.file` names one account.
- ERC-8004 readers that expect `registrations` to name the agent find it empty, and must read the
  registry's `Registered` event or `ownerOf` for the id.
- The version a file names grows old as the agent updates; the file cannot say so.

## Alternatives

- **List every live wallet**, as spec 1 says now. It links each token a launch wallet launched and
  each deposit a bridge wallet made to the agent, for good. Lost on privacy.
- **List the main wallets of every chain.** binference serves the registry on BSC alone; another
  chain's wallet is the same address on every EVM chain today. Lost as adding nothing.
- **Leave the version out.** The owner's spec names it, and it tells a reader which software runs
  the agent. Kept as the owner's choice; the cost is a public, lasting hint of the agent's age.
- **The version in its own top-level key** (`"binference": "2026.11.2"`). The ERC's structure has
  no such key, and a `services` entry carries an optional `version` already. Lost.
- **Name the agent id with a second transaction** (`setAgentURI`). It needs a ceiling rule for
  `setAgentURI`, which could then rewrite the file under stolen keys, and a second tap. Lost.
