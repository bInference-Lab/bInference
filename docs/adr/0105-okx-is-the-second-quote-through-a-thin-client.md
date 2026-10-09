# 0105. OKX is the second quote through a thin client

Status: Accepted

## Context

KyberSwap is the primary route. [ARCHITECTURE.md section 7](../ARCHITECTURE.md#section-7) named
PancakeSwap's Smart Router SDK as the second quote and the fallback. Measured on 2026-10-09 with
Node 26.10 and the repository's pnpm settings:

- `@pancakeswap/smart-router` 7.8.0 pins viem 2.37.13 (the repository uses 2.57.1) and pulls 125
  packages, the Solana SDK among them, three install scripts and two high advisories, one with no
  fixed release. It calls four hosts with the global `fetch`, without a signal or a timeout. A quote
  of 0.1 BNB for USDT took 4 to 5 s and 444 to 494 RPC requests. On an anvil fork its pool listing
  took 40 s, outlived the public node's state and quoted no route.
- `@pancakeswap/universal-router-sdk` 1.5.7, which builds routes through Infinity pools, does not
  load as ESM on Node 26.
- OKX's official `@okx-dex/okx-dex-sdk` 1.0.19 is CommonJS and pulls 276 packages (Solana, Sui,
  ethers, web3, axios), five install scripts, one critical and five high advisories. It calls the
  global `fetch` without a signal, ignores its own timeout option, retries every error three times,
  and signs and sends transactions with a private key, which the engine never holds.

The owner chose a DEX aggregator over reaching pools ourselves: OKX's DEX aggregator API, version
6, which needs the owner's API key, secret and passphrase.

## Decision

- The `okx` plugin is the second quote and the fallback. The composition root installs it only
  when `venues.keys.okx` names the owner's key. KyberSwap stays the keyless primary route
  ([rule 16](../ARCHITECTURE.md#rule-16)).
- It is a thin client on the `Http` port against OKX's REST API as its docs describe it: signed
  GETs of `quote`, `swap` and `get-liquidity`, the four headers of OKX's authentication guide, and
  every code of OKX's error list mapped to no route or to a fault that names the code. The venue
  retries nothing.
- OKX's DEX router and TokenApprove on BNB Chain come from OKX's smart contract page, were read on
  chain on 2026-10-09 and sit in the registry. A call to any other router refuses the build. An
  input token gets an exact approval of TokenApprove.
- OKX's answers name a route's protocols, never its pools or hooks, so routes through PancakeSwap
  Infinity and Uniswap v4 are excluded by their DEX ids: one hook allowlist covers every route.
- The decoder takes only the router's DAG swaps, without commission or trim terms and with the
  input pulled from the sender.

## Consequences

- Without an OKX key, binference routes through KyberSwap alone, with no keyless fallback.
- OKX's docs publish no rate limit figures: a 429 or code 50011 is a retryable fault, and that
  quote goes without OKX.
- OKX encodes a deadline about an hour out and its own minimum; the venue brings the deadline
  forward to the host's and raises the minimum to the host's in the calldata.
- Liquidity in PancakeSwap Infinity and Uniswap v4 pools is out of OKX's reach here.
- A router call other than `dagSwapTo` or `dagSwapByOrderId` is refused: 97% of 1,157 router calls
  sampled on BNB Chain on 2026-10-09 were DAG swaps.
- When OKX moves its router, the venue refuses its calls until the registry lists the new address.
- The fork test needs the owner's key in the environment.

## Alternatives

- **PancakeSwap's Smart Router SDK.** The dependency tree, the advisories, the untimed calls, the
  pinned viem and the load above. Rejected.
- **Our own quotes on PancakeSwap's on-chain quoters.** Custom pool reach. Rejected by the owner.
- **OKX's SDK.** CommonJS, the dependency tree and the advisories above, and it signs with a
  private key. Rejected.
