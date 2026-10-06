---
name: clean-diff
description: Strips filler from a change before review. Use on your own diff when the code works and before review-diff, to remove narrating comments, speculative helpers, one-use wrappers, duplicate guards and words the style guard refuses.
---

# Clean the diff

Run this on the diff you wrote, after the tests pass and before `review-diff`. It removes what a
reviewer should never have to read. It changes no behavior.

## 1. Read the diff

```sh
git diff --staged
git diff master...HEAD
```

Read every changed line once, top to bottom, with the questions below.

## 2. Comments

- Every public export keeps one TSDoc block: what it does and what a caller must know.
- A `//` comment stays only when it states a constraint the code cannot show: ownership,
  lifecycle, ordering, cleanup, platform or a dependency's quirk.
- Delete comments that narrate the next line, explain syntax, record history or name a task.
- Delete commented-out code. Delete `TODO`, `FIXME` and `XXX`; open an issue instead.

## 3. Code that earns nothing

- A helper with one caller and no second user coming: inline it.
- A wrapper that only renames or forwards: call the target.
- A guard for a state the types or an earlier check rule out: delete it.
- A parameter, option or export no caller uses: delete it.
- A second copy of logic that exists elsewhere: call the first copy, or move it to the lowest
  package both callers share.
- An abstraction with one implementation and no test fake: remove the layer.

## 4. Names and words

- Names come from `docs/GLOSSARY.md`, never from other agent frameworks.
- Units sit in names: `timeoutMs`, `slippageBps`, `amountBase`, `usdMicros`.
- Booleans read as questions: `isFrozen`, `hasQuote`, `canSign`.
- Text is short, active and in the present tense. No em or en dashes, no emojis, no words from
  `config/style/banned-words.txt`.
- Every new word a person sees exists in English and Simplified Chinese.

## 5. Tests

- Test names are sentences that state the behavior.
- No conditional expects, no focused or skipped tests, no sleeps or real timers.
- Delete tests that only repeat the implementation; keep the ones that pin behavior.

## 6. Check and report

```sh
pnpm format
pnpm check:style --files <each changed file>
pnpm check
```

Report what you removed and why, in a few lines, then run `review-diff`.
