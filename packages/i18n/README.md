# @binference/i18n

## Purpose

Every word binference shows on Telegram, in the console and in the CLI, in English and Simplified
Chinese, and the one formatter every surface uses for messages, token amounts, USD values, rates
and times. Messages are ICU texts in `messages/<locale>/<area>.json`, formatted by FormatJS
`intl-messageformat`.

## API

| Export                            | What it does                                                            |
| --------------------------------- | ----------------------------------------------------------------------- |
| `createFormatter`, `Formatter`    | Messages, amounts, money, rates and times for one language and timezone |
| `messages`, `Catalog`             | Every message by language, under full keys such as `reason.daily_cap`   |
| `messageLocales`, `MessageLocale` | The languages with messages: `en` and `zh`                              |

## Example

```ts
import { createFormatter } from "@binference/i18n";

const display = createFormatter({ locale: owner.locale, timeZone: owner.timezone });

display.message("reason.daily_cap", {
  used: display.usd(612_400_000n), // "$612.40"
  cap: display.usd(1_000_000_000n), // "$1,000.00"
});
display.tokenAmount(500_000_000_000_000_000n, 18); // "0.5"
display.percent(bpsSchema.parse(50)); // "0.50%"
display.time(expiresAt); // "14:32:05" in the owner's timezone
```
