# @binference/i18n

Every word binference shows, in English and Simplified Chinese, and the one formatter for amounts
and times.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- Numbers and money read the same in both languages (`$1.20`, `0.005 BNB`), so the amount
  formats are en-US; dates follow the language. Amounts stay `bigint` until `Intl` formats their
  exact decimal text.
- Chinese text sits only in files whose path names `zh`, such as `*.zh.test.ts`. Code builds a
  Chinese character from its code point.
- It is pure: no I/O, no clock, no `process`. Tests sit beside the code as `*.test.ts`.
