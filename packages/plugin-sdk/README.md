# @binference/plugin-sdk

## Purpose

What plugins import. A venue plugin defines itself with `defineVenue`: the contracts it touches on
each chain, by their names in the chain registry, the functions its trades call and the contracts
an approval may name as spender, and how it quotes, builds and decodes a trade. A wallet's ceiling
lets the wallet call those functions and approve those spenders, and nothing else of the venue.
The engine's venue host gives the venue its contracts' addresses, sets the trade's terms, and
decodes every transaction the venue builds; it refuses one that calls another contract, pays
another account, spends another amount, accepts less than the policy's minimum output or runs past
60 seconds. A chain whose trade calls carry no deadline, such as a launchpad's curve, says so with
`noDeadline`, and only there does the host pass a call without one.

A launchpad defines itself with `defineLaunchpad`: a venue that also reads its curve. Given a
token, `curve` answers from the launchpad's own contracts whether the token is on its bonding curve
now and what the curve trades it against. The engine sends a buy or a sell of a curve token to its
launchpad and nowhere else. A launchpad that reads a chain takes that chain's `RpcFailover` from
`@binference/plugin-sdk/evm`, given by the composition root.

A venue that holds the state a token's price comes from, such as a launchpad's curve, declares
`priceRead` (`PriceReader`): given a token, the read calls (`ReadCall`) that price it and a pure
`price` step that turns their answers (`ReadAnswer`) into the price in its quote asset, or
`no_price_read`. The price watcher asks every watched token's calls in one batched read at each new
block, so the calls take no block of their own, and the step never throws: answers that price
nothing are `unpriced`, and answers that say the read no longer holds, such as a token that left
its curve, are `replan` (`PriceMiss`).

A risk plugin returns a `TokenRiskSource`: given a token, it reports its findings as
`RiskFlagCode`s and the liquidity it knows of, `not_covered` for a token it has no answer for, and
rejects when its service is down. It decides nothing; the engine's risk step does.

A data plugin defines itself with `defineData`: a `MarketDataSource` that reads a token's pools
(`MarketPool`) and a chain's trending tokens (`TrendingToken`), `not_covered` for a chain it does
not serve, and rejects when its service is down. A source whose service publishes them also reads a
token's candles (`candles`, `MarketCandle` per `CandleRequest`) and the prices the price watcher
cross-checks (`prices`); one without them is never asked. Its figures inform the owner and the agent
and never price a trade. `@binference/plugin-sdk/data` gives it what every data service's client
needs: `parseJsonText` keeps each number as the text the answer wrote, `ratioOf`, `usdMicrosOf`,
`changeBpsOf` and `wholeOf` read those texts exactly, and `createPacedReader` sends each documented
read under the service's published limits, waits out a 429 once and turns every other answer into a
typed fault.

A skills plugin ships `SKILL.md` files. `lintSkill` reads one, or any other text file of a skill,
and names each sentence that tells the agent to ask for or collect a secret (a seed or recovery
phrase, a private key, an API key, a token, a password or a passphrase, in English or Chinese),
that pipes a download into a shell, that sends the environment or a key file over the network, or
that writes a secret out in full; a finding never repeats the secret. It is the install lint of
[ARCHITECTURE.md section 5](../../docs/ARCHITECTURE.md#section-5), which refuses a skill with a
finding, so a skill's author runs it before publishing.

## API

| Export                                                                   | What it does                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `defineVenue`                                                            | Checks a venue's declaration and returns the frozen venue                                |
| `defineLaunchpad`, `LaunchpadVenue`, `CurveReader`                       | A venue that also says which tokens are on its bonding curve                             |
| `CurveRequest`, `CurveHolding`                                           | What the host asks a launchpad, and where it holds the token                             |
| `PriceReader`, `PriceRead`, `PriceReadRequest`, `ReadCall`, `ReadAnswer` | The reads that price a token each block, and the step that prices their answers          |
| `Venue`, `VenueDeclaration`, `VenueContracts`, `VenueCall`               | A venue: its contracts, calls and spenders per chain, and its parts                      |
| `QuoteRequest`, `VenueQuote`, `BuildRequest`, `DecodedEffect`            | What the host asks and what the venue answers                                            |
| `TxDraft`                                                                | A transaction before the wallet queue adds its nonce and fees                            |
| `ok`, `err`, `Result`, `BinferenceError`, `isBps`, `bpsSchema`           | What a venue needs to answer                                                             |
| `Http`, `HttpRequest`, `HttpResponse`                                    | The port a venue reaches its API through                                                 |
| `chainRefSchema`, `accountRefSchema`, `assetRefSchema`                   | CAIP ids, parsed; `accountRefParts`, `assetRefParts` split them                          |
| `@binference/plugin-sdk/evm`                                             | `encodeEvmDraft`, `decodeEvmDraft`, `decodeCall`, `callAbiJson`                          |
| `RpcFailover`, `RpcCall`, `RpcReply` (from `/evm`)                       | The port a venue reads its contracts through, by `eth_call`                              |
| `TokenRiskSource`, `TokenRiskReport`, `RiskFlagCode`                     | A risk data source and what it reports about a token                                     |
| `orderedFlags`                                                           | A report's findings in their fixed order, each once                                      |
| `defineData`, `MarketDataSource`, `MarketPool`, `TrendingToken`          | A market data source, checked and frozen, and what it reads                              |
| `MarketCandle`, `CandleRequest`, `CandleInterval`, `candleIntervals`     | A candle in USD, which candles a chart asks for, and the intervals                       |
| `@binference/plugin-sdk/data`                                            | `createPacedReader`, `pathSegment`, `parseJsonText` and the exact figure readers         |
| `lintSkill`, `SkillFinding`                                              | The sentences of a skill the install refuses, each with its code and line                |
| `@binference/plugin-sdk/testing`                                         | The venue, curve, risk and market data contract suites, scripted HTTP and a manual clock |

## Example

A venue for an EVM router. `swapFunction`, `fetchRoute`, `swapData` and `effectOf` are the plugin's
own code: the router's swap function from its ABI, its API client, its calldata encoder and its
decoder, which reads the terms back from the calldata.

```ts
import { BinferenceError, defineVenue, err, ok } from "@binference/plugin-sdk";
import { callAbiJson, decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";

export const exampleVenue = defineVenue({
  id: "example-swap",
  contracts: [
    {
      chain,
      names: ["router"],
      calls: [{ contract: "router", abi: callAbiJson(swapFunction), walletInputs: ["to"] }],
      spenders: ["router"],
    },
  ],
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
