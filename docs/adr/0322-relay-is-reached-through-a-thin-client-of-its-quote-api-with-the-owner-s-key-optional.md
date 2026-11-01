# 0322. Relay is reached through a thin client of its quote API, with the owner's key optional

Status: Accepted

Accepted by the owner on 2026-11-01: keyless now, the key optional, and after 2026-11-24 a late
notice that asks for a key.

## Context

Relay is the second bridge plugin and the only one to Solana and to USDG on Robinhood Chain
([decisions 0301](0301-a-bridge-route-moves-a-dollar-to-a-dollar-or-eth-to-eth-as-the-bridge-s-api-lists-it.md)
and [0316](0316-only-relay-delivers-dollars-as-usdg-on-robinhood-chain.md)). Its deposit names
only an order id, so it leaves only from a bridge wallet
([decisions 0303](0303-relay-deposits-run-only-from-a-bridge-wallet-the-owner-funds-from-outside.md)
and [0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)).
Relay's docs and API, read on 2026-11-01:

- The official SDK `@relayprotocol/relay-sdk` 8.0.4 (2026-10-06) depends on axios, takes viem as a
  peer, and its execute actions sign and send with a wallet client, which the engine never holds.
  `@relay-protocol/settlement-sdk` 0.0.152 (2026-10-30), which the docs name for working out an
  order id, ships CommonJS with no exports map, pins viem 2.47.6 exactly (a second viem), and pulls
  in tronweb, `@solana/web3.js` 1, Anchor, TON and bitcoinjs for one hash.
- `POST /quote/v2` is the quote API; `POST /quote` is deprecated. The docs say every `quote/v2`
  request needs an API key from 2026-10-02; on 2026-11-01 it still answered without one. Default
  limits per App are 50 quotes a minute and 200 `/requests/v3` reads a minute. The rate-limit guide
  asks a client to retry a 429 after an exponential backoff.
- `GET /requests/v3` needs an API key. `GET /requests/v2` answers without one, is deprecated, has
  been rate limited in stages since 2026-09-01 (it answered 429 after three reads in 20 seconds),
  and retires on 2026-11-24. `GET /intents/status/v3` takes only the quote's request id, which the
  bridge port's status read does not carry.
- Asked with no slippage, a quote's least output equals its expected output (19.899080 USDC for 20
  BSC USDC to Base). Left to Relay, the least was 19.501099, 2.5% under the input: below the floor
  of the default 1% slippage limit (decision 0319), so every route would end `price_impact`.
- An order stays fillable on chain for 7 days whatever is asked; `ttl` refunds a request Relay has
  not filled within it.
- The docs list 38 quote error codes, and `failReason` and `refundFailReason` for a request. Their
  errors guide asks a client to retry `PRICE_FETCH_FAILED`, `REQUEST_TIMED_OUT`, `RPC_HTTP_ERROR`
  and `SERVICE_UNAVAILABLE` with a backoff before it surfaces them. The API also answered
  `BLOCKED_WALLET_ADDRESS`, which no list names, for a wallet its screening blocks (anvil's first
  account, on 2026-11-01).

## Decision

- `plugins/relay` is a thin client on the `Http` port. A quote is `POST /quote/v2` with
  `tradeType` `EXACT_INPUT`, the wallet as `user` and `refundTo`, `refundOnOrigin`,
  `includeProtocolData`, `slippageTolerance` `"0"` and `ttl` 3,600 seconds. The quote holds until 5
  minutes before that time to live ends, so a deposit signed at its last moment still lands and is
  filled before Relay would refund it. An answer that names one of the four codes the errors guide
  calls passing is asked once more, 1 second later; a quote moves nothing, so the second ask is
  safe. Quotes are not paced: each follows an owner's or agent's request, far under 50 a minute,
  and a 429 reads as `relay.rate_limited`.
- The owner's Relay API key is optional: `venues.keys.relay`, a secret source read at start
  (config version 12). With it every request sends `x-api-key`; without it the client asks the
  same endpoints keyless.
- Where a deposit stands is read by its transaction: `GET /requests/v3?depositTxHash=` with a key,
  `GET /requests/v2?hash=` without one. Once Relay retires version 2, a keyless install reads
  `relay.unauthorized`.
- The bridge follower (decision 0320) still marks a bridge late 2 hours after its deposit is final
  when its venue cannot say where it stands, with the venue's page for the deposit, which the
  bridge port's `pageOf` works out without asking the venue (Relay's
  `https://relay.link/transaction/<hash>`). A status read that fails is logged by its fault's code,
  at most once an hour per bridge, never with Relay's text. A throttled answer rests the venue's
  reads from 30 seconds, doubling on each throttled answer up to 15 minutes, until it answers
  again. A refused or missing key tells the owner once while the engine runs, by
  `notice.bridgeKeyNeeded` in English and Chinese, which names `venues.keys.relay`.
- The client works out an order's id itself (decision 0323): no Relay SDK is a dependency, and
  Solana addresses come through `@solana/kit`'s codec, the repository's Solana SDK.
- Each of Relay's 38 quote error codes, and `BLOCKED_WALLET_ADDRESS`, maps to an answer or a
  fault: an amount under or over the route's limits or its solvers' liquidity names its reason
  (decision 0317); a chain, token or route Relay does not serve, a token or wallet it will not
  touch, and a swap it judges too costly are `no_route`; a request it refuses is
  `relay.bad_request`; a missing or refused key is `relay.unauthorized`; a throttled route or a 429
  is `relay.rate_limited`, and Relay's own faults are `relay.unavailable`, both retryable. A failed
  fill Relay will not refund reads as expired.
- `createRelayVenue` gives the venue host Relay's declaration and trades nothing, as Brew's venue
  does (decision 0278), so the limits and a bridge wallet's ceiling know its deposits. Relay is
  in no agent's default venues: an agent that names it needs a live bridge wallet first
  (`limit.needs_bridge_wallet`, decision 0307), so it would stop every new agent going live.

## Consequences

- A quote is one HTTP request, two after a passing fault, and the build none: the deposit is
  built from the quote's record.
- Relay may refuse keyless quotes at any time, as its docs announce; a refusal reads as
  `relay.unauthorized` and the bridge quote fails as the venue down, until the owner sets a key.
- From 2026-11-24 a keyless install cannot read where a Relay deposit stands: no Relay bridge
  settles until the owner sets a key, each is marked late with its notice at 2 hours, and the owner
  is told once which key to set. Once the key is set and binference restarted, the next pass reads
  each one and settles it on its own chain.
- A deposit that lands after the quote's time to live is refunded by Relay to the wallet, less
  its refund gas.
- To bridge through Relay, the owner makes a bridge wallet, funds it from outside and adds
  `relay` to the agent's venues.
- Every bridge plugin gives a page for a deposit without a request (`pageOf`); Across gives
  `https://across.to/transfer/<hash>`.

## Alternatives

- **Relay's SDK.** Untimed axios calls without the caller's signal, and actions that sign. Rejected.
- **The settlement SDK for the order id.** A second viem and five chains' SDKs for one hash.
  Rejected.
- **Relay's own slippage.** Every quote would fall under the default limit's floor. Rejected.
- **`/intents/status/v3` by request id.** Keyless today, but the port's status read and the stored
  bridge carry only the deposit's transaction; storing the request id would widen the port and the
  bridge record for a read the requests endpoint gives, and the late notice needs only the
  deposit's page. The record keeps no request id. Left for when Relay retires keyless reads.
- **Pacing every quote to 50 a minute.** Quotes follow requests, far under the limit; a 429 already
  reads as a retryable fault. Rejected.
- **Relay in every agent's default venues.** Every new agent would need a bridge wallet to go
  live. Rejected.
