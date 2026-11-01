# 0315. Across is reached through a thin keyless client of its Swap API

Status: Accepted

Accepted by the owner on 2026-11-01, keyless for now, with the second review's checks folded in
before the lock: the output equal to the least and the expected output and to the input less the
fees, Across's timing bounded, the quote kept with what was asked, and typed reasons for limits.

## Context

Across is the first bridge plugin ([decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)).
Its deposit is re-encoded as `depositV3`, whose every bound input a ceiling reads
([decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md)).
Across's docs name the Swap API (`GET /swap/approval`) for new integrations, and mark
`/suggested-fees`, `/limits` and `/available-routes` as legacy and no longer maintained. Measured on
2026-11-01:

- Across's official `@across-protocol/app-sdk` 0.6.1 (2026-06-10) depends on zod 3 (the repository
  uses zod 4) and on viem as a peer. Its fetch helper calls the global `fetch` with no signal and no
  timeout, and its execute actions sign and send with a wallet client, which the engine never holds.
- Its error list, `AcrossErrorCode`, names 15 codes; the docs' API reference names the error shape
  (`type`, `code`, `status`, `message`, `param`) and `429` for a rate limit.
- `swap/approval` answers a direct bridge with `crossSwapType` `bridgeableToBridgeable`, one
  `bridge` step with its fees in the token that leaves, `expectedFillTime` in seconds,
  `quoteExpiryTimestamp` an hour after the quote, and the deposit encoded as `deposit` with 32-byte
  values, followed by 3 bytes Across appends to mark its calls.
- Asked for WETH on arrival, it encodes a deposit to its own handler contract with a message that
  forwards the WETH. Asked for the coin (the zero address), it encodes a plain deposit of WETH to the
  recipient with an empty message, which a fill pays an account with no code as ETH.
- An amount outside the route's limits answers `AMOUNT_TOO_LOW` or `AMOUNT_TOO_HIGH`, and one above
  what relayers hold now `LOW_BRIDGE_LIQUIDITY`, a code no list names: BSC ETH to Robinhood Chain
  quoted at 11:30 UTC and answered it at 12:07. While Across
  served nothing from BSC (2026-10-30), every route answered `INVALID_PARAM` with no parameter.
  BSC to Solana answers `INVALID_PARAM` on `outputToken`.
- At 12:10 UTC every ETH route from BSC answered `anyToAny` instead: a swap on each side through
  the periphery, while `/limits` gave the direct route a maximum of 0. An hour earlier the same
  routes were direct.
- The docs ask for an API key and an integrator id in production, and warn that requests without
  them may be rate-limited or refused. Every request above was answered without them.

## Decision

- `plugins/across` is a thin client on the `Http` port, keyless: `swap/approval` for a quote, with
  `tradeType=exactInput`, the wallet as depositor and refund address, `refundOnOrigin=true` and
  `skipOriginTxEstimation=true` (the engine simulates every step itself); `deposit/status` by the
  deposit's transaction for its state.
- A route is asked only when the registry lists it for Across and its token that leaves has a
  24-hour cap ([decision 0305](0305-a-fifth-24-hour-cap-bounds-the-eth-a-wallet-approves-on-bsc.md));
  a route that arrives as the destination's wrapped coin is asked for the coin.
- An answer with a swap on either side is `no_route`: no listed route swaps (decision 0301).
- The answer must be a direct bridge of exactly the asked tokens and amount, through the
  registry's SpokePool, from the wallet to the asked recipient, with an empty message, its output
  equal to its least and its expected output and to the input less Across's three fees in the
  output token's decimals, an exclusivity of at most 10 minutes, a fill deadline after the quote's
  expiry and at most 6 hours after the quote (Across's recommended deadline), and an expiry at most
  an hour after the quote; anything else is `across.bad_quote`. The bridge keeps Across's own terms
  (the output, the exclusive relayer and the timing) with what was asked, refuses a build for
  another request (`across.quote_mismatch`), and encodes `depositV3` itself, with an exact approval
  of the SpokePool. It never sends Across's bytes.
- Each code of Across's error list, and `LOW_BRIDGE_LIQUIDITY`, maps to an answer or to a fault
  that names it: an amount under or over the route's limits or its liquidity names its reason
  (`amount_too_low`, `amount_too_high`, `low_liquidity`, decision 0317); a route not enabled, a
  quote Across cannot give, and an invalid token or chain (or none named) are `no_route`; a request it refuses is `across.bad_request`; a rate limit
  (`across.rate_limited`), a fault upstream, an unknown code or an answer outside the schema are
  retryable faults (`across.unavailable`). The bridge retries nothing.
- A deposit Across has not indexed yet is `unseen`; `received` and `slowFillRequested` read as
  pending. Across's page for a deposit is `https://across.to/transfer/<hash>`.
- Across serves no route from BNB Smart Chain to Solana, and `depositV3` names a 20-byte recipient
  only, so the bridge declares no Solana destination and answers `no_route` for a Solana
  recipient. Across's id for Solana (`34268394551451`) is declared only when a route serves it.

## Consequences

- A quote is one HTTP request, and the build none: the deposit is built from the quote's record, so
  its terms are the card's.
- Across may rate-limit or refuse keyless requests at any time. A rate limit reads as a retryable
  fault and the bridge quote fails as the venue down; an API key would need a config key, its secret
  source and its migration.
- The ETH routes' delivery arrives as ETH at a wallet and as WETH at a contract, as decision 0301
  expects; the deposit names WETH either way.
- When Across serves nothing from BSC, every Across route answers `no_route`; nothing is stored or
  sent, and the surfaces name the next step in bridge words.
- If Across drops `depositV3`, the simulation of the deposit fails and nothing moves.

## Alternatives

- **Across's app SDK.** A second zod major and untimed calls without a signal. Rejected.
- **The legacy `/suggested-fees` and `/limits`.** They give `depositV3`'s values directly, but the
  docs no longer maintain them and point new integrations to the Swap API. Rejected.
- **Asking for WETH on the ETH routes.** The deposit would pay Across's handler with a message, which
  the signer refuses and no ceiling can bind. Rejected.
- **Using Across's API key now.** It needs the owner to register a project with Across and a config
  key for its secret; every read needed so far was answered without it. Left for the owner.
