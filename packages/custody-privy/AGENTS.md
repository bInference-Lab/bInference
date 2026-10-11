# @binference/custody-privy

The `privy-owner` custody adapter: key quorums, the ceiling, agent wallets and signing calls
through Privy's API (spec 5, decision 0085).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is money code: a change here runs the `review-money-path` skill. No `Number` or `parseFloat`
  on an amount; wei travels as `bigint` and as hex quantities on the wire.
- Privy is called through its official Node SDK, `@privy-io/node`, never by hand. Each call makes
  its own SDK client whose `fetch` rides on the core `Http` port and stops with the call's signal;
  the SDK's retries and logs stay off. The exceptions are `POST /v1/aggregations` and
  `DELETE /v1/aggregations/<id>`, which the SDK does not offer: `src/privy/aggregations.ts` sends
  them on the same port, as Privy's recipe does (decision 0149). Only the custody suite's cleanup
  deletes one. Remove them once the SDK has the calls. A signing request is sent once; a lost answer is
  `custody.sign_unknown`, and the engine decides what follows.
- Every answer the SDK gives passes a zod schema in a `*.schema.ts` file and leaves the package as
  our own types. Privy may add fields to its answers: objects keep the fields read and drop the
  rest.
- The SDK forms the authorization payload; the signer signs it only after `readPayload` reads the
  same request back from those exact bytes, which must be the bytes `authorizationPayload` of
  `@binference/chain` writes. That function is the only copy of Privy's payload.
- The app secret is a core `Secret`, revealed only into the Basic auth header. Faults carry the
  path and the status, never a header, a body or a key.
- The ceiling is Privy's policy language: one rule per function a venue declares, and 24-hour
  caps as aggregations the app sums over every wallet (decision 0149). A change to `src/ceiling/`
  changes what every wallet may sign: the known-answer test and the property test against the fake's policy engine change with
  it, and the change needs the owner key on every existing wallet.
- The owner key changes a ceiling's recipients only through `src/wallets/ceiling-recipients.ts`:
  each send rule of each chain, found by its name, is written over with a `PATCH` the policy's
  owner signs, at once or ahead. A change signed ahead is sent only while every rule lists what it
  listed when the change was signed, and never before every rule was checked, so it never undoes
  a later change. The owner signs only the request `ruleChangeRequest` writes, byte for byte.
- A wallet's added signers change only through `src/wallets/signer-moves.ts`, with a `PATCH` the
  wallet's owner signs: `swapSigner` makes one agent key each wallet's one signer in a single change
  per wallet, so no wallet ever takes two machines' signatures, and `removeSigner` never leaves a
  wallet without a signer. Every change is read back.
- The signer is reached only through the `SignerProcess` port of `@binference/chain`, with its
  `AuthorizeInput` (spec 5, section 5.1). The port's suite runs against the fake signer here and
  against the signer's real process in `@binference/signer`. This package never holds the agent
  key or the owner key's private half.
- `src/testing/` holds the Privy fake, the fake signer and the fixtures; only it imports viem. The
  custody contract in `src/contracts/` runs against the fake in `pnpm check` and against the Privy
  test app when `BINFERENCE_PRIVY_TESTS=1` and the app's id and secret are in the environment.
