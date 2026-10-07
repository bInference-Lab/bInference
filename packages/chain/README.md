# @binference/chain

## Purpose

The model every chain shares. Chains, accounts and assets are CAIP ids; an `Amount` is an asset
and its base units; a chain family turns addresses into their canonical form, reads transaction
drafts and checks signatures; the registry holds the chains binference may use. It also holds
the venue ports: what a venue declares, quotes, builds and decodes, so the engine and the plugin
SDK share one definition, and the transaction simulator, which runs drafts unsent so the engine
can check what they move. Nothing here names a chain or a venue.

## API

| Export                                                                | What it does                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ChainRef`, `parseChainRef`, `printChainRef`, `chainRefParts`         | CAIP-2 chain ids                                                 |
| `AccountRef`, `parseAccountRef`, `printAccountRef`, `accountRefParts` | CAIP-10 account ids                                              |
| `AssetRef`, `parseAssetRef`, `printAssetRef`, `assetRefParts`         | CAIP-19 asset types                                              |
| `chainRefSchema`, `accountRefSchema`, `assetRefSchema`                | The same ids parsed at a boundary                                |
| `Amount`, `amountSchema`                                              | An asset and its base units, as JSON carries them                |
| `ChainFamily`, `SigningScheme`, `ChainRegistry`                       | The ports a family package and the composition root fill         |
| `Signer`, `SignRequest`                                               | Custody: signs an approved intent's transaction for a wallet     |
| `SignerProcess`, `AuthorizeInput`, `authorizeInputSchema`             | The signer's `authorize` request (spec 5, 5.1), and its JSON     |
| `SignStep`, `SignAuthorization`, `AutoModeGrant`, `AllowedTargets`    | The step, the approval and the targets the hard rules check      |
| `checkAutoModeGrant`, `AutoModeGrantProblem`, `autoModeKinds`         | Whether an auto grant authorizes a signature now, and why not    |
| `SignerRefusal`                                                       | Why the signer refused: the request, or a hard rule by number    |
| `PrivyRequest`, `privyRequestSchema`, `authorizationPayload`          | A Privy request, and the bytes its authorization signature signs |
| `PriceSource`, `UsdPrice`                                             | An asset's USD price now, in micro-dollars per base unit         |
| `withQuotePrice`, `QuotedTrade`                                       | A trade's other token priced from the trade's own quote          |
| `ChainDefinition`, `chainDefinitionSchema`                            | One chain as data: tokens, contracts, RPCs, relays and explorers |
| `createChainRegistry`                                                 | The registry, which refuses data its family does not accept      |
| `UnsignedTx`, `SignedTx`, `TxHash`                                    | Transactions as the core passes them, opaque inside              |
| `TxDraft`, `txDraftSchema`, `DraftCall`, `TokenApproval`              | A venue's transaction before its nonce and fees, and its read    |
| `Venue`, `Quoter`, `TxBuilder`, `TxDecoder`                           | The venue ports: quote, build and decode one protocol's trades   |
| `VenueDeclaration`, `venueDeclarationSchema`                          | A venue's id and its contracts per chain, by registry name       |
| `QuoteRequest`, `VenueQuote`, `BuildRequest`, `DecodedEffect`         | What the venue host asks a venue, and what the venue answers     |
| `TxSimulator`, `SimulatedStep`, `AssetTransfer`, `AssetApproval`      | Runs drafts unsent and reports what each moved and allowed       |
| `isSameAccount`                                                       | Whether two accounts are one, compared in the family's form      |
| `@binference/chain/testing`                                           | Contract suites for each port, a fake family, chain and venue    |

## Example

```ts
import { assetRefParts, parseAssetRef } from "@binference/chain";

const parsed = parseAssetRef(text);
if (!parsed.ok) {
  return parsed;
}
const { chain, assetReference } = assetRefParts(parsed.value);
```
