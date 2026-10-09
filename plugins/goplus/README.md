# @binference/goplus

## Purpose

The `goplus` risk source. Before the agent buys a token the chain registry does not list, the
engine asks GoPlus's Token Security API what it knows about the token's contract: a honeypot, a
hidden owner, an owner who can change balances, a blacklist, a tax the owner can change, and the
liquidity of its pools.

- **Ask.** `GET https://api.gopluslabs.io/api/v1/token_security/{chain_id}?contract_addresses=…`
  for one ERC-20 token of an EIP-155 chain, without a key. GoPlus answers one token per call
  without an access token.
- **Read.** Each flag GoPlus sets to `"1"` becomes a finding; a whole buy or sell tax (`"1"`) means
  the token cannot be bought or sold; `is_open_source` and `is_true_token` count only when they are
  `"0"`. The liquidity of every pool GoPlus lists is added up in micro-dollars, rounded down.
- **Codes.** GoPlus answers errors with HTTP 200 and a code. Data still syncing (2), an unsupported
  chain (2018, 2022), an address that is no contract (2007, 2020) and no contract information (2021)
  are `not_covered`. Too many requests (4029, or HTTP 429) is a retryable `goplus.rate_limited`
  fault; a server error (5000, HTTP 5xx) a retryable `goplus.unavailable`; any other code a
  `goplus.unavailable` fault that names it.
- **Limits.** GoPlus's free use is 150 compute units a minute and 30,000 a day. The engine keeps
  each answer in its risk cache for `risk.cacheTtlSec` (10 minutes), so a token is asked about at
  most once in that time.

## API

| Export               | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `createGoplusSource` | The `goplus` risk source over an `Http` port         |
| `GoplusOptions`      | The `Http` port the source reaches GoPlus's API with |

## Example

The composition root builds the source with the engine's outbound HTTP:

```ts
import { createGoplusSource } from "@binference/goplus";

const goplus = createGoplusSource({ http });
const report = await goplus.check(asset, { signal });
```
