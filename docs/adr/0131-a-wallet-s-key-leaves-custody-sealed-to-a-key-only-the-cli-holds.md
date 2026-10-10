# 0131. A wallet's key leaves custody sealed to a key only the CLI holds

Status: Accepted

## Context

[Spec 5, section 6](../specs/keys-and-backups.md#section-6) says `binference wallet export` asks for
the owner key, requests Privy's export with a fresh HPKE key pair, decrypts it in the CLI process,
prints it once and zeroes it. The protocol's `wallet/exportKey` answers `{ privateKey }`, so the key
would cross the engine and the IPC socket in the clear, and the server keeps a write's answer in
the idempotency store. Privy's Node SDK has `exportPrivateKey`, which makes the HPKE pair and
decrypts in the process that calls it: the engine. Privy's export API (`POST
/v1/wallets/<id>/export`) takes a recipient public key, needs the wallet owner's authorization
signature, and answers `{ ciphertext, encapsulated_key }` sealed with DHKEM P-256, HKDF-SHA256 and
ChaCha20-Poly1305. Privy's export docs open it with `@hpke/core` and `@hpke/chacha20poly1305`.
Protocol v1 takes additions only. The owner decided on 2026-10-10.

## Decision

- The CLI makes a fresh HPKE recipient key for each export: an ECDH P-256 pair from WebCrypto, its
  private half not extractable. Only the public half, DER SubjectPublicKeyInfo in base64, leaves
  the process.
- A new operation, `wallet/exportSealed`, takes `{ wallet, recipientPublicKey, ownerKey }`, needs
  `admin`, runs over IPC only, and answers `{ ciphertext, encapsulatedKey }`. It is a read: no
  idempotency key, so no store keeps its answer. `wallet/exportKey` stays in v1 unserved.
- The engine finds the wallet, any the install holds, archived ones too, and asks custody's
  `WalletExporter` port. The Privy adapter checks the code is the install's owner key, signs
  Privy's export request with it, and passes the sealed key on unopened, through the SDK's REST
  export call rather than `exportPrivateKey`.
- Before the owner key is asked for, the CLI warns that anyone with the key controls every token in
  the wallet, and asks for the wallet address's last 4 characters, in any case. It opens the sealed
  key, prints it once and fills the opened bytes with zeros.
- The HPKE library is `@hpke/core` 1.9.0 with `@hpke/chacha20poly1305` 1.8.0: the packages Privy's
  export docs name and its Node SDK already pulls in, MIT, each the latest release and older than 7
  days (ENGINEERING 17). Node has no HPKE. The CLI uses them in production; custody-privy only in
  `src/testing`, where the fake Privy seals with them.

## Consequences

- The private key never exists outside the CLI process: not in the engine, its logs, the socket,
  the idempotency store or a journal.
- The text the terminal prints cannot be zeroed: JavaScript strings are immutable. The bytes it is
  made from are.
- A composition with no exporter, such as Cloud, answers `wallet.custody_down`; there the owner
  exports in Privy's own window.
- Spec 7's table needs a `wallet/exportSealed` row, and `wallet/exportKey` marked unserved, in the
  next protocol version's notes.
- check:package-graph now writes one lint override per limited folder, so a folder may allow more
  than one library.

## Alternatives

- **Serve `wallet/exportKey` with the SDK's `exportPrivateKey`.** The engine would hold the key and
  the store would keep it. Rejected by the owner.
- **Add optional fields to `wallet/exportKey`.** Its answer requires `privateKey`, and v1 cannot
  make it optional. Rejected.
- **Hand-write HPKE on `node:crypto`.** ECDH, HKDF and ChaCha20-Poly1305 are there, but the
  key schedule would be our own code to audit, against the library Privy documents. Rejected.
- **`hpke-js`.** The same author's umbrella package, larger, and not the one Privy's docs name.
  Rejected.
