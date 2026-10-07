# @binference/signer

The owner and agent keys, and the signer process that holds the agent key and checks the hard
rules.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is money code: the 95% coverage bar and Stryker's 80% mutation score. A change here runs the
  `review-money-path` skill.
- It imports only `core` and `chain`. It reads no file, config, database or network: it decides
  the keys, and the composition root hands it the `SecretStore` the unlock mode names. Platform
  stores the bytes.
- The signer process runs under Node's permission model with no grant and drops every scope once
  it is loaded, so its code never opens a file, a socket, a process or a worker, and never loads a
  module after start: no dynamic `import()` on its path. `src/process/signer-sandbox.test.ts`
  builds the entry and proves it; keep it passing.
- The signer's channel is its standard input and output: the settings line, the agent key's line,
  then one JSON request per line, answered in order, one at a time. Requests and answers have
  their schemas in `src/requests/`; an unknown request is refused, never guessed at.
- The hard rules (keys spec, section 5.2) live in `src/rules/`, one file per rule. A change to a
  rule moves its test that breaks only that rule and the oracle of
  `check-hard-rules.property.test.ts` in the same commit; the oracle is written apart from the
  rules and must stay that way. Stryker's 80% bar applies to them.
- Privy's authorization signature is pinned by known answers from Privy's own SDK, and
  `src/privy-sdk/` holds it to the SDK's bytes for any request, with `@privy-io/node` as a
  test-only dependency. A change to the payload's bytes breaks every signature Privy checks.
- Keys never reach a log, an error, a test title or an assertion message. A private half travels
  as a Node `KeyObject` or a `Secret`; tests compare public halves. Buffers that held a private
  scalar or its DER are zeroed once used.
- Randomness for keys comes from Node's crypto, which draws on the OS CSPRNG. Checksums and other
  values derived from a key are compared with `timingSafeEqual`.
- Key formats are pinned by known-answer tests built outside this code (RFC 4648 and SEC 2
  vectors, Python's hashlib and base64, the openssl command line). A change that breaks one breaks
  every owner's saved code or agent-key file: it needs a new version, never an edit.
- The agent key's entry is `agent-key` in every unlock mode; the `manual` mode's file is the
  passphrase store's sealed secret (keys spec, section 3), never a second format.
