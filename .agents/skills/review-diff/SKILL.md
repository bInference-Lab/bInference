---
name: review-diff
description: Reviews a change against the engineering rules that no tool checks. Use before opening a pull request, after clean-diff, and when asked to review a branch or a diff.
---

# Review the diff

`pnpm check` covers the rules a tool can judge. This review covers the rest. Run it after
`clean-diff` and before the pull request opens.

## 1. Gather

```sh
git diff master...HEAD --stat
git diff master...HEAD
pnpm check
```

Read the issue or task the change serves. A red `pnpm check` comes first: fix it before reviewing.

## 2. Design

- One owner per responsibility: one module decides and writes each piece of state.
- The change moves every caller and deletes the old path, with its exports, tests and docs.
- Use cases receive their ports through a factory. Only the composition root in `cli` builds
  adapters.
- Core code never branches on a chain, venue, model provider or chat app; registries do.
- A new port has a contract test suite, and every adapter passes it.
- A new abstraction has a second implementation or a test fake that uses it.
- Every queue, buffer, cache and map has a maximum size and a stated overflow policy.
- Database work runs on worker threads.

## 3. Errors, data and config

- Expected outcomes return `Result`; faults throw `BinferenceError` with a dotted code.
- People see i18n text chosen by an error code, never `error.message`.
- Every boundary input is parsed by zod at once; types come from `z.infer`.
- Data definitions use `satisfies`; exported data carries a type annotation instead, since
  `isolatedDeclarations` refuses `satisfies` on an exported value. Nothing mutates an input.
- A config change ships its config migration. Every key has a `.describe()` text. A risky switch
  is named `dangerously...` and defaults to off.
- Logs carry ids, never prompts, model output, chat text or secrets.

## 4. Names and words

- Names come from `docs/GLOSSARY.md`; none is borrowed from another agent framework.
- Functions are verbs, factories start with `create`, booleans read as questions, units sit in
  names. Abbreviations are limited to `id`, `url`, `rpc`, `tx`, `abi` and `usd`.
- American English. Short, active, present-tense sentences.

## 5. Tests and evidence

- Behavior is tested at the cheapest layer that proves it.
- A regression test fails on the original defect; the failing run is in the PR evidence.
- A change to `engine`, `signer`, `chain`, `chain-evm`, `chains` or `protocol` also runs
  `review-money-path`.
- A load-bearing decision has its ADR (`write-adr`).

## 6. Hygiene

- No secrets, `.env` files, keystores, local paths or internal notes in the diff.
- The license stays MIT.

## 7. Report

List findings by severity, each with `file:line`, the rule and the fix. Say plainly when there is
nothing to fix. Then run `shape-commit`.
