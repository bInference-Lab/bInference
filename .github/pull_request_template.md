## Problem

<!-- What is wrong or missing, in a few plain sentences. -->

## Impact

<!-- What a user or a developer notices once this lands. -->

## Evidence

<!-- The commands you ran and what they showed: the tests, pnpm check, a failing run before a fix. -->

## Money path

<!-- Keep this section when the change touches engine, signer, chain, chain-evm, chains or protocol. Tick each line once you checked it. -->

- [ ] Amounts stay bigint base units from input to output.
- [ ] An intent changes state only through the intent state machine.
- [ ] Side effects happen only in the wallet queue, after it rechecks the confirmation.
- [ ] Nothing retries after a side effect.
- [ ] Every network call and child process has a signal and a timeout.
- [ ] Secrets stay out of logs, URLs and command lines.
- [ ] Money fields in tool arguments are decimal strings.
- [ ] Policy and amount changes come with property tests.

## Dependencies

<!-- For each new or changed dependency: the job it does, what else you considered, and why a Node built-in does not do it. -->
