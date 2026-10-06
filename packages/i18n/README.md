# @binference/i18n

## Purpose

The one formatter every surface uses for token amounts, USD values, rates and times, in English and
Simplified Chinese. Amounts stay `bigint` until `Intl` formats their exact decimal text.

## API

| Export                            | What it does                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| `createFormatter`, `Formatter`    | Amounts, money, rates and times for one language and timezone |
| `messageLocales`, `MessageLocale` | The languages binference speaks: `en` and `zh`                |

## Example

```ts
import { createFormatter } from "@binference/i18n";

const display = createFormatter({ locale: owner.locale, timeZone: owner.timezone });

display.tokenAmount(500_000_000_000_000_000n, 18); // "0.5"
display.usd(612_400_000n); // "$612.40"
display.percent(bpsSchema.parse(50)); // "0.50%"
display.time(expiresAt); // "14:32:05" in the owner's timezone
```
