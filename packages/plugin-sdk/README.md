# @binference/plugin-sdk

## Purpose

What plugins import. A venue plugin defines itself with `defineVenue`: the contracts it touches on
each chain, by their names in the chain registry, and how it quotes, builds and decodes a trade.
The engine's venue host gives the venue its contracts' addresses, sets the trade's terms, and
decodes every transaction the venue builds; it refuses one that calls another contract, pays
another account, spends another amount, accepts less than the policy's minimum output or runs past
60 seconds.

A risk plugin returns a `TokenRiskSource`: given a token, it reports its findings as
`RiskFlagCode`s and the liquidity it knows of, `not_covered` for a token it has no answer for, and
rejects when its service is down. It decides nothing; the engine's risk step does.

## API

| Export                                                         | What it does                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `defineVenue`                                                  | Checks a venue's declaration and returns the frozen venue           |
| `Venue`, `VenueDeclaration`, `VenueContracts`                  | A venue: its id, its contracts per chain, quoter, builder, decoder  |
| `QuoteRequest`, `VenueQuote`, `BuildRequest`, `DecodedEffect`  | What the host asks and what the venue answers                       |
| `TxDraft`                                                      | A transaction before the wallet queue adds its nonce and fees       |
| `ok`, `err`, `Result`, `BinferenceError`, `isBps`, `bpsSchema` | What a venue needs to answer                                        |
| `Http`, `HttpRequest`, `HttpResponse`                          | The port a venue reaches its API through                            |
| `chainRefSchema`, `accountRefSchema`, `assetRefSchema`         | CAIP ids, parsed; `accountRefParts`, `assetRefParts` split them     |
| `@binference/plugin-sdk/evm`                                   | `encodeEvmDraft`, `decodeEvmDraft`, `decodeCall`, `parseEvmAddress` |
| `TokenRiskSource`, `TokenRiskReport`, `RiskFlagCode`           | A risk data source and what it reports about a token                |
| `orderedFlags`                                                 | A report's findings in their fixed order, each once                 |
| `@binference/plugin-sdk/testing`                               | The venue and risk source contract suites, and `createScriptedHttp` |

## Example

A venue for an EVM router. `fetchRoute`, `swapData` and `effectOf` are the plugin's own code: its
API client, its calldata encoder and its decoder, which reads the terms back from the calldata.

```ts
import { BinferenceError, defineVenue, err, ok } from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";

export const exampleVenue = defineVenue({
  id: "example-swap",
  contracts: [{ chain, names: ["router"] }],
  async quote(request, { signal }) {
    const route = await fetchRoute(request, signal);
    return route === undefined ? err("no_route") : ok(route.quote);
  },
  async build(request) {
    const router = request.contracts["router"];
    if (router === undefined) {
      throw new BinferenceError({ code: "example.no_router", message: "No router here." });
    }
    const data = swapData(request);
    return [encodeEvmDraft({ from: request.wallet, to: router, value: 0n, data })];
  },
  decode(draft) {
    const call = decodeEvmDraft(draft);
    const effect = call.ok ? effectOf(draft.chain, call.value) : undefined;
    return effect === undefined ? err("unknown_call") : ok(effect);
  },
});
```
