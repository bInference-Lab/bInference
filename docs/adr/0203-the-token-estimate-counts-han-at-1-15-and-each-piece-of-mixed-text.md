# 0203. The token estimate counts Han at 1.15 and each piece of mixed text

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[Decision 0202](../DECISIONS.md#d0202) adds message and call overhead to the text weights of
[spec 8](../specs/runtime.md) section 7.3: a CJK character one token, other text one per 4
characters. The estimate decides when a session compacts before the first provider count, so it
must not fall short. Five Chinese requests an owner sends, counted locally on 2026-10-13 from
OpenAI's published tokenizer files (cl100k_base and o200k_base, each matching its expected
sha256), hold 136 tokens in cl100k_base and 97 in o200k_base. The old weights give 116: 15% short
of cl100k_base in total and 39% short on the line with an amount and two tickers
(a swap of 0.1 BNB for USDT under 1% slippage: 28 tokens, estimated 17). A number, a ticker or a
space between CJK characters is a token of its own, which 4 characters a token misses, and
cl100k_base splits some Han ideographs in two.

## Decision

- **A Han ideograph counts as 1.15 tokens**, summed over the text and rounded up. Kana, Hangul,
  Bopomofo, CJK punctuation and full-width forms stay at one token each.
- **Each stretch of other text counts the larger of** one token per 4 characters and its pieces: a
  number of up to 3 digits, a word, a run of symbols, or spaces that no word follows.
- **The test fixtures** hold the five counted lines. The estimate may not fall more than 15% below
  the heavier encoding on any line, and stays within 5% of it over all five. Overcounting against
  o200k_base is accepted.
- The rest of decision 0202 stands.

## Consequences

- The five lines estimate 25, 31, 28, 25 and 31 tokens (140 in all): at most 10.7% below
  cl100k_base on a line and 2.9% above it in total. Against o200k_base they are 14% to 67% above.
- English prose keeps one token per 4 characters; JSON and short mixed text count higher, closer
  to what a tokenizer gives, so compaction comes slightly earlier.
- The first provider count still replaces the estimate for what that call held.

## Alternatives

- **Shipping a tokenizer.** Exact for one family of models only, several megabytes of tables in
  the runtime, and the provider's count arrives after the first call anyway.
- **Raising every CJK character to 1.2 or more.** Covers the mixed line only by overcounting plain
  Chinese by 18% or more against cl100k_base, and still misses tickers and numbers in Latin text.
- **Counting other text at 2 characters a token.** Doubles every English and JSON estimate to cover
  the short stretches between CJK characters.
