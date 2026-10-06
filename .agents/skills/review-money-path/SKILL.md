---
name: review-money-path
description: Reviews a change that can move funds or decide whether they move. Use on every change to engine, signer, chain, chain-evm, chains or protocol, and paste the ticked checklist into the pull request.
---

# Review the money path

Money code fails closed: when policy, risk, simulation or signing is in doubt, the action is
refused. Run this after `review-diff` on any change to `engine`, `signer`, `chain`, `chain-evm`,
`chains` or `protocol`. CI refuses such a pull request without the ticked checklist.

## 1. Gather

```sh
git diff master...HEAD -- packages/engine packages/signer packages/chain packages/chain-evm packages/chains packages/protocol
```

## 2. Check each line

Tick a line only after you checked it in the diff.

- **Amounts stay bigint base units from input to output.** No `number`, `parseFloat`, `toFixed` or
  implicit coercion on an amount. Decimals appear only when parsing what a person typed and when
  i18n formats for display. USD is bigint micro-dollars; rates are integer basis points.
- **An intent changes state only through the intent state machine.** No other module writes the
  state column, and the transition table test covers the new path.
- **Side effects happen only in the wallet queue, after it rechecks the confirmation.** The
  recheck sits right before signing, not earlier.
- **Nothing retries after a side effect.** Retries use the retry module, on transient faults
  only, with a cap on attempts and total time.
- **Every network call and child process has a signal and a timeout.**
- **Secrets stay out of logs, URLs and command lines.** Keys and tokens never reach a log record,
  an error message or a query string.
- **Money fields in tool arguments are decimal strings,** parsed by the shared decimal-string
  schema, never through `number`.
- **Policy and amount changes come with property tests** beside the module.

Also check, without a checklist line:

- Names carry their units: `amountBase`, `slippageBps`, `usdMicros`, `timeoutMs`.
- Stored amounts are decimal strings of base units; times are epoch milliseconds in UTC.
- The ledger is append-only; nothing updates or deletes an entry.
- A raw transaction is stored before broadcast, so recovery never sends twice.

## 3. Report

Paste the ticked checklist into the pull request's `## Money path` section, exactly as the
template words it. For every line you could not tick, give `file:line` and what must change.
