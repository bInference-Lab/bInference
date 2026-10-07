import { createPublicKey, verify } from "node:crypto";
import type { FakePrivyState, FakeQuorum, FakeSigner, FakeWallet } from "./fake-privy-state.js";

// A DER P-256 signature in base64 is about 96 characters; anything far longer is no signature.
const maxSignatureText = 200;

function signedBy(key: string, payload: Buffer, signature: string): boolean {
  if (signature.length > maxSignatureText) {
    return false;
  }
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(key, "base64"),
      format: "der",
      type: "spki",
    });
    return verify("sha256", payload, publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Whether enough members of a quorum signed the payload to meet its threshold. */
function quorumSigned(quorum: FakeQuorum, payload: Buffer, signatures: readonly string[]): boolean {
  const signers = quorum.publicKeys.filter((key) =>
    signatures.some((signature) => signedBy(key, payload, signature)),
  );
  return signers.length >= quorum.threshold;
}

/** Who authorized a wallet request: its owner, one of its added signers, or nobody. */
export type FakeParty =
  | { readonly kind: "owner" }
  | { readonly kind: "signer"; readonly signer: FakeSigner };

/**
 * Finds the party whose signatures authorize a request on a wallet. A wallet with no owner needs
 * none: the app secret alone acts for it, as on Privy.
 */
export function authorizingParty(
  state: FakePrivyState,
  wallet: FakeWallet,
  signed: { readonly payload: Buffer; readonly signatures: readonly string[] },
): FakeParty | undefined {
  const owner = wallet.ownerId === null ? undefined : state.quorums.get(wallet.ownerId);
  if (
    wallet.ownerId === null ||
    (owner !== undefined && quorumSigned(owner, signed.payload, signed.signatures))
  ) {
    return { kind: "owner" };
  }
  const signer = wallet.signers.find((item) => {
    const quorum = state.quorums.get(item.signerId);
    return quorum !== undefined && quorumSigned(quorum, signed.payload, signed.signatures);
  });
  return signer === undefined ? undefined : { kind: "signer", signer };
}
