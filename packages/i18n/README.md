# @binference/i18n

## Purpose

Every word binference shows on Telegram, in the console and in the CLI, in English and Simplified
Chinese, and the one formatter every surface uses for messages, token amounts, USD values, rates
and times. Messages are ICU texts in `messages/<locale>/<area>.json`, formatted by FormatJS
`intl-messageformat`.

## API

| Export                                        | What it does                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `createFormatter`, `Formatter`                | Messages, amounts, money, rates and times for one language and timezone     |
| `messages`, `Catalog`                         | Every message by language, under full keys such as `reason.daily_cap`       |
| `messageLocales`, `MessageLocale`             | The languages with messages: `en` and `zh`                                  |
| `@binference/i18n/check`: `checkCatalogs`     | The same files, keys and arguments in every language; ICU that parses       |
| `@binference/i18n/check`: `checkGlossary`     | Chinese that uses the glossary's word wherever the English uses a term      |
| `@binference/i18n/check`: `checkCodeMessages` | A message for every code of a closed list, such as the protocol error codes |
| `@binference/i18n/check`: `parseGlossary`     | The term tables under "Chinese terms" in `docs/GLOSSARY.md`                 |
| `@binference/i18n/check`: `parseMessage`      | A message's arguments and words, so a test can match them to its values     |

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
