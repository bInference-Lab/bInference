# @binference/i18n

Every word binference shows, in English and Simplified Chinese, and the one formatter for messages,
amounts and times.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- Messages live in `messages/<locale>/<area>.json`: one flat JSON object per area, keys without
  the area (`engine.locked` in `error.json` is `error.engine.locked`), values in ICU syntax. A new
  message is one edit to the English file and one to the Chinese file. A new area file is also
  imported once in `src/messages.ts`.
- English is the source. Chinese has the same keys and the same arguments, and uses the words of
  the [Chinese terms](../../docs/GLOSSARY.md#chinese-terms) in the glossary; a term the glossary
  lacks goes there first. Follow the card spec's wording where it fixes one
  ([spec 4](../../docs/specs/cards-and-messages.md)).
- `error.json` holds one message per protocol error code, keyed by the code; `reason.json` one per
  intent reason code. Each error message names the next step.
- Values are formatted before they reach a message: `{amount}` gets `formatter.tokenAmount(...)`.
  ICU `plural` takes a count. Never build a sentence by joining messages.
- Numbers and money read the same in both languages (`$1.20`, `0.005 BNB`), so the amount
  formats are en-US; dates and plurals follow the language. Amounts stay `bigint` until `Intl`
  formats their exact decimal text.
- Chinese text sits only in files whose path names `zh`: the zh messages and `*.zh.test.ts`.
  Code builds a Chinese character from its code point.
- It is pure: no I/O, no clock, no `process`. Tests sit beside the code as `*.test.ts`.
