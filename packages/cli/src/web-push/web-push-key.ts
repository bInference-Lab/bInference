import { Buffer } from "node:buffer";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { BinferenceError, createSecret, type SecretStore } from "@binference/core";

/**
 * The engine's VAPID key pair (RFC 8292, decision 0158): the private half signs each push
 * message's token, the public half is the key every browser subscribes with.
 */
export interface WebPushKey {
  readonly privateKey: KeyObject;
  /** The public key, uncompressed, in base64url: the browser's `applicationServerKey`. */
  readonly publicKey: string;
}

/** The `keys/` entry that holds the VAPID private key as PKCS #8 in base64url. */
export const webPushKeyEntry = "web-push-vapid";

function publicKeyOf(privateKey: KeyObject): string {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const x = Buffer.from(jwk.x ?? "", "base64url");
  const y = Buffer.from(jwk.y ?? "", "base64url");
  return Buffer.concat([Buffer.of(0x04), x, y]).toString("base64url");
}

function unreadable(cause?: ErrorOptions["cause"]): BinferenceError {
  return new BinferenceError({
    code: "web_push.key_unreadable",
    message: `keys/${webPushKeyEntry} holds no P-256 private key. Remove it: binference makes a new one at its next start.`,
    ...(cause === undefined ? {} : { cause }),
  });
}

function keyOf(text: string): WebPushKey {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(text, "base64url"),
      format: "der",
      type: "pkcs8",
    });
  } catch (error) {
    throw unreadable(error);
  }
  if (
    privateKey.asymmetricKeyType !== "ec" ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw unreadable();
  }
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

/** Makes a new VAPID key pair on P-256. */
function makeKeyText(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
}

/**
 * Opens the VAPID key from the owner-only `keys/` store, making and storing a new one when the
 * entry is missing: on an install from before browser push, or on a new machine, whose copy of the
 * state folder leaves `keys/` behind. Throws `web_push.key_unreadable` for an entry that holds no
 * P-256 private key.
 */
export async function openWebPushKey(store: SecretStore, signal: AbortSignal): Promise<WebPushKey> {
  const stored = await store.read(webPushKeyEntry, signal);
  if (stored.ok) {
    return keyOf(stored.value.reveal());
  }
  const text = makeKeyText();
  await store.write(webPushKeyEntry, createSecret(text), signal);
  return keyOf(text);
}
