# @binference/signer

## Purpose

The keys behind custody and the signer process (keys spec, sections 2, 3 and 5). It makes P-256
key pairs from the OS CSPRNG, writes the owner key as the `bnok1` code the owner keeps offline and
reads it back with its checksum, and keeps this machine's agent key at rest in the secret store its
unlock mode names. The signer process holds the agent key and answers the engine with Privy's
authorization signature over each request it is asked to authorize.

## API

| Export                                    | What it does                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `P256KeyPair`, `createP256KeyPair`        | A P-256 key pair; the public half as DER SubjectPublicKeyInfo in base64       |
| `formatOwnerKeyCode`, `parseOwnerKeyCode` | The owner key as a `bnok1` code with a 4-byte checksum, and back              |
| `OwnerKeyCodeProblem`                     | Why a code was refused: `malformed` or `checksum_mismatch`                    |
| `formatAgentKey`, `parseAgentKey`         | The agent key as every unlock mode holds it: DER PKCS #8 in base64            |
| `agentKeyEntry`                           | `agent-key`, the secret store entry of the agent key                          |
| `createAgentKey`, `openAgentKey`          | Makes and stores the agent key once, and opens it at start                    |
| `authorizationPayload`                    | The bytes Privy's authorization signature covers (RFC 8785 JSON)              |
| `signAuthorization`                       | Privy's authorization signature: ECDSA P-256 over SHA-256, DER in base64      |
| `signerNodeArguments`                     | The Node arguments that start the signer under the permission model           |
| `openSignerClient`, `SignerClient`        | The engine's client of the signer process: `publicKey` and `authorize`        |
| `SignerSettings`, `signerSettingsSchema`  | The chains and the Privy API origin the signer is started with                |
| `AuthorizeInput`, `authorizeInputSchema`  | What `authorize` takes (keys spec, section 5.1), and its JSON form            |
| `SignerRequest`, `SignerAnswer`           | The messages on the signer's channel                                          |
| `@binference/signer/process`              | The built signer process, `dist/signer-process.mjs`: one file, never imported |

## The signer process

The engine starts `process.execPath` with `signerNodeArguments(entry)`, where `entry` is the real
path of `@binference/signer/process`, and pipes for standard input and output. Those pipes are the
signer's only channel; only the engine holds them.

- The signer runs under Node's permission model with no grant. Once loaded, it drops every scope,
  even the read of its own program, and refuses to run when any is left: it can open no file,
  socket, child process or worker.
- The engine writes one line per message. The first holds the settings as JSON
  (`{ chains, privyApi }`), the second the agent key's text, then one JSON request per line. Every
  buffer that held the key line is zeroed.
- The signer answers each request on one line, in order, and reads the next line only after it has
  written the answer. A refused line gets `{ id, ok: false, refused }`.
- On a fault (`signer.not_sealed`, `signer.settings_invalid`, `signer.agent_key_invalid`,
  `signer.line_too_long`) it writes `{ fault }` as its last line and exits with code 1. It exits
  with code 0 when the engine closes its input.

## Example

```ts
import { createAgentKey, createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";

const owner = createP256KeyPair();
show(formatOwnerKeyCode(owner).reveal()); // once, in the terminal only
const ownerKeyPublic = owner.publicKey; // kept as custody.privy.ownerKeyPublic

const agent = await createAgentKey(platform.keychain, signal);
if (!agent.ok) {
  return agent; // "exists": this machine already has an agent key
}
```

The composition root starts the signer and opens its client:

```ts
import { openSignerClient, signerNodeArguments } from "@binference/signer";

const entry = fileURLToPath(import.meta.resolve("@binference/signer/process"));
const child = execa(process.execPath, signerNodeArguments(entry), {
  stdin: "pipe",
  stdout: "pipe",
});
const signer = await openSignerClient({
  answers: child.stdout,
  write: async (line) => writeLine(child.stdin, line),
  end: async () => child.stdin.end(),
  settings: { chains: ["eip155:56"], privyApi: "https://api.privy.io" },
  agentKey, // the Secret read from the unlock mode's store
  logger: logger.child("signer"),
  onRefusal: (notice) => notices.raise(notice),
});
const signature = await signer.authorize(input, signal);
```
