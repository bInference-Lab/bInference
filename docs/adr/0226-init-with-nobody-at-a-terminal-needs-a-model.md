# 0226. Init with nobody at a terminal needs a model

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Decision 0222](../DECISIONS.md#d0222) let a run nobody answers finish without a model when no
`--model-*` flag was given, and its summary told the owner to link one later with
`binference init --start-over` in a terminal. A Docker or server install has no terminal for
that, and a start over makes a new owner key and a new wallet. The agent of such an install could
never chat. [Decision 0221](../DECISIONS.md#d0221) already blocks a person at the terminal until
a model answers its live check.

## Decision

- A new set-up nobody answers needs the model as it needs the Privy app: the provider
  (`--model-provider`), the model (`--model`), the address for a compatible provider
  (`--model-base-url`), and the key as a secret source (`--model-key`) for every provider but a
  compatible one, which may run on the owner's machine without one. Each comes from its flag, its
  `BINFERENCE_INIT_*` variable or the answers file.
- They are checked with the other answers before anything is written
  ([decision 0225](../DECISIONS.md#d0225)): a missing one is `init.needs_flag` naming its flag,
  variable and file key, and a provider init does not offer is `init.bad_model_provider`. The live
  check of decision 0221 follows, before Privy makes anything.
- Every finished set-up links a model: the summary always names it, and the JSON answer's `model`
  is never `null`.
- This amends decision 0222, whose run nobody answers linked no model without the flags.

## Consequences

- An install set up in a container can chat from its first start.
- Scripts and tests that ran init without a model now pass one.
- The summary line for an install with no model is gone.

## Alternatives

- **Keep the model optional and warn.** The warning names a fix, a start over at a terminal, that
  a container cannot run and that replaces the wallet.
- **Link the model later with a config change.** A key set that way gets no live check before it
  is saved, and nothing in the set-up tells the owner a model is missing.
