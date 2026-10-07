# @binference/core

## Purpose

The base every other package builds on: results and the one error class, branded ids, `bigint`
amount math in basis points, retry with jitter, deadlines on `AbortSignal`, secrets that never
print, and the `Clock`, `Random`, `Logger`, `Http` and `SecretStore` ports. It does no I/O; adapters
live in other packages.

## API

| Export                                     | What it does                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `Result`, `ok`, `err`                      | An expected outcome: a value, or a failure named by a string literal |
| `BinferenceError`, `isErrorCode`           | The one error class, with a dotted code and redacted details         |
| `redactSecrets`                            | Masks private keys, recovery phrases, bot tokens and binference keys |
| `Secret`, `createSecret`                   | A secret value that prints, logs and serializes as `[secret]`        |
| `Brand`                                    | A nominal type for ids, accounts, assets and amounts                 |
| `mulDiv`, `applyBps`, `splitByBps`         | Amount math on base units with a stated rounding direction           |
| `Bps`, `bpsSchema`, `isBps`                | Integer rates in basis points, 0 to 10,000                           |
| `decimalStringSchema`                      | A decimal string of an unsigned integer to `bigint`, and back        |
| `Id`, `idSchema`, `isId`, `createIdSource` | UUIDv7 ids behind a type prefix                                      |
| `retry`                                    | Retries transient faults with capped exponential backoff and jitter  |
| `createDeadline`                           | A signal that aborts on its parent or after a timeout on the clock   |
| `Clock`, `Random`, `Logger`, `Http`        | The ports that adapters implement                                    |
| `SecretStore`, `checkSecretName`           | The port for named secrets at rest, and the entry names it takes     |
| `@binference/core/testing`                 | Contract suites for each port, and fakes that pass them              |

## Example

```ts
import { applyBps, bpsSchema, retry } from "@binference/core";

const feeBase = applyBps(1_500_000_000_000_000_000n, bpsSchema.parse(30), "up");

const balance = await retry(async ({ signal }) => readBalance(signal), {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  budgetMs: 5_000,
  signal,
  clock,
  random,
});
```
