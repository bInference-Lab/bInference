# @binference/signer

## Purpose

The keys behind custody (keys spec, sections 2 and 3). It makes P-256 key pairs from the OS
CSPRNG, writes the owner key as the `bnok1` code the owner keeps offline and reads it back with its
checksum, and keeps this machine's agent key at rest in the secret store its unlock mode names. The
signer process and its hard rules come next.

## API

| Export                                    | What it does                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `P256KeyPair`, `createP256KeyPair`        | A P-256 key pair; the public half as DER SubjectPublicKeyInfo in base64 |
| `formatOwnerKeyCode`, `parseOwnerKeyCode` | The owner key as a `bnok1` code with a 4-byte checksum, and back        |
| `OwnerKeyCodeProblem`                     | Why a code was refused: `malformed` or `checksum_mismatch`              |
| `formatAgentKey`, `parseAgentKey`         | The agent key as every unlock mode holds it: DER PKCS #8 in base64      |
| `agentKeyEntry`                           | `agent-key`, the secret store entry of the agent key                    |
| `createAgentKey`, `openAgentKey`          | Makes and stores the agent key once, and opens it at start              |

## The owner key code

`bnok1`, then 58 lowercase base32 characters (RFC 4648, no padding) in groups of five split by
spaces: the 32-byte private scalar, then the first 4 bytes of SHA-256 over `bnok1` and the scalar.
The 2 bits after the last byte must be zero. Spaces, dashes and case do not matter when it is read
back, and a wrong character is refused.

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
