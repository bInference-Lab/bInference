# @binference/honeypot-is

## Purpose

The `honeypot` risk source. Before the agent buys a token the chain registry does not list, the
engine asks honeypot.is, which buys, transfers and sells the token in its own simulation and checks
whether the token's holders could sell.

- **Ask.** `GET https://api.honeypot.is/v2/IsHoneypot?address=…&chainID=…` for one ERC-20 token of
  a chain honeypot.is serves (Ethereum, BNB Smart Chain, Base), without a key. The source always
  names the chain.
- **Read.** honeypot.is's honeypot verdict, a test sale or buy at a tax of 100%, a limit on one
  sale, code it cannot read, a proxy, a risk level of 60 or more (read by number, as honeypot.is's docs
  advise), and the summary flags its docs list
  (holders who could not sell, siphoned wallets, blocked transfers, sale limits). The tested pair's
  liquidity becomes micro-dollars, rounded down.
- **Statuses.** HTTP 404 (no such token, or no pair to test) is `not_covered`. HTTP 429 is a
  retryable `honeypot.rate_limited` fault that names when the limit resets (`x-ratelimit-reset`);
  HTTP 5xx a retryable `honeypot.unavailable`; any other status or an answer outside the documented
  shape a `honeypot.unavailable` fault. honeypot.is answered with a limit of 50 requests in its
  `x-ratelimit-limit` header; its docs publish no limit.
- **Use.** The engine keeps each answer for `risk.cacheTtlSec` (10 minutes). honeypot.is's terms
  forbid reselling or sharing its API; each owner's engine asks it for that owner's own trades.

## API

| Export                 | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `createHoneypotSource` | The `honeypot` risk source over an `Http` port            |
| `HoneypotOptions`      | The `Http` port the source reaches honeypot.is's API with |

## Example

The composition root builds the source with the engine's outbound HTTP:

```ts
import { createHoneypotSource } from "@binference/honeypot-is";

const honeypot = createHoneypotSource({ http });
const report = await honeypot.check(asset, { signal });
```
