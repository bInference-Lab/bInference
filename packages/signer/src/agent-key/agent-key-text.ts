import { createPrivateKey, type KeyObject } from "node:crypto";
import { createSecret, err, type Result, type Secret } from "@binference/core";
import { type P256KeyPair, p256KeyPairOf } from "../keys/p256-key-pair.js";

/**
 * The agent key as every unlock mode holds it: the private half as DER PKCS #8 in base64, on one
 * line, the form Privy's own tools give a private key. The keychain entry, the owner-only file,
 * a secret command's output and the sealed file of the `manual` mode all carry this text.
 */
export function formatAgentKey(pair: P256KeyPair): Secret {
  const der = pair.privateKey.export({ type: "pkcs8", format: "der" });
  try {
    return createSecret(der.toString("base64"));
  } finally {
    der.fill(0);
  }
}

function importPkcs8(der: Buffer): KeyObject | undefined {
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    return undefined;
  }
}

/**
 * Reads the agent key's text back into its key pair; whitespace around it, such as a file's last
 * newline, does not matter. `malformed` for text that is not base64, not a private key, or a key
 * of another curve or kind.
 */
export function parseAgentKey(text: Secret): Result<P256KeyPair, "malformed"> {
  const compact = text.reveal().trim();
  const der = Buffer.from(compact, "base64");
  try {
    const key = der.toString("base64") === compact ? importPkcs8(der) : undefined;
    if (key === undefined) {
      return err("malformed");
    }
    const pair = p256KeyPairOf(key);
    return pair.ok ? pair : err("malformed");
  } finally {
    der.fill(0);
  }
}
