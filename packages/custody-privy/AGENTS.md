# @binference/custody-privy

The `privy-owner` custody adapter: key quorums, the ceiling, agent wallets and signing calls
through Privy's API (spec 5, decision 0085).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is money code: a change here runs the `review-money-path` skill. No `Number` or `parseFloat`
  on an amount; wei travels as `bigint` and as hex quantities on the wire.
- Privy is called through its official Node SDK, `@privy-io/node`, never by hand. Each call makes
  its own SDK client whose `fetch` rides on the core `Http` port and stops with the call's signal;
  the SDK's retries and logs stay off. A signing request is sent once; a lost answer is
  `custody.sign_unknown`, and the engine decides what follows.
- Every answer the SDK gives passes a zod schema in a `*.schema.ts` file and leaves the package as
  our own types. Privy may add fields to its answers: objects keep the fields read and drop the
  rest.
- The SDK forms the authorization payload; the signer signs it only after `readPayload` reads the
  same request back from those exact bytes.
- The app secret is a core `Secret`, revealed only into the Basic auth header. Faults carry the
  path and the status, never a header, a body or a key.
- The ceiling is Privy's policy language. A change to `src/ceiling/` changes what every wallet may
  sign: the known-answer test and the property test against the fake's policy engine change with
  it, and the change needs the owner key on every existing wallet.
- The signer is reached only through the `SignerProcess` port, shaped like spec 5, section 5.1.
  This package never holds the agent key or the owner key's private half.
- `src/testing/` holds the Privy fake, the fake signer and the fixtures; only it imports viem. The
  custody contract in `src/contracts/` runs against the fake in `pnpm check` and against the Privy
  test app when `BINFERENCE_PRIVY_TESTS=1` and the app's id and secret are in the environment.
