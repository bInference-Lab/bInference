# @binference/signer

The owner and agent keys, and the signer process that holds the agent key and checks the hard
rules.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is money code: the 95% coverage bar and Stryker's 80% mutation score. A change here runs the
  `review-money-path` skill.
- It imports only `core` and `chain`. It reads no file, config, database or network: it decides
  the keys, and the composition root hands it the `SecretStore` the unlock mode names. Platform
  stores the bytes.
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
