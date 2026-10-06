import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { createSecret, err, ok, type Result, type Secret } from "@binference/core";
import type { SealedSecret } from "./sealed-secret.schema.js";

/** What a seal binds the secret to, and its scrypt cost. */
export interface SealContext {
  readonly format: string;
  readonly aad: string;
  readonly cost: number;
}

const blockSize = 8;
const keyBytes = 32;

async function deriveKey(passphrase: Secret, salt: Buffer, cost: number): Promise<Buffer> {
  // scrypt holds 128 * N * r bytes; Node refuses more than 32 MiB unless told.
  const maxmem = 2 * 128 * cost * blockSize;
  // The same words typed on two systems can differ in Unicode form; NFC makes them one passphrase.
  const text = passphrase.reveal().normalize("NFC");
  return new Promise((resolve, reject) => {
    scrypt(text, salt, keyBytes, { N: cost, r: blockSize, p: 1, maxmem }, (error, key) => {
      if (error === null) {
        resolve(key);
      } else {
        reject(error);
      }
    });
  });
}

/** Seals a secret with a passphrase, with a new random salt and nonce. */
export async function sealSecret(
  value: Secret,
  passphrase: Secret,
  context: SealContext,
): Promise<SealedSecret> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, context.cost);
  const plaintext = Buffer.from(value.reveal(), "utf8");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(context.aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      format: context.format,
      version: 1,
      kdf: "scrypt",
      kdfParams: {
        n: context.cost,
        r: blockSize,
        p: 1,
        dkLen: keyBytes,
        salt: salt.toString("base64"),
      },
      cipher: "aes-256-gcm",
      iv: iv.toString("base64"),
      aad: context.aad,
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

/**
 * Opens a sealed secret. Returns `wrong_passphrase` when the tag does not match: the passphrase is
 * wrong, or a byte of the file changed. AES-GCM cannot tell the two apart.
 */
export async function openSealedSecret(
  sealed: SealedSecret,
  passphrase: Secret,
): Promise<Result<Secret, "wrong_passphrase">> {
  const params = sealed.kdfParams;
  const key = await deriveKey(passphrase, Buffer.from(params.salt, "base64"), params.n);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(sealed.aad, "utf8"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);
    const secret = createSecret(plaintext.toString("utf8"));
    plaintext.fill(0);
    return ok(secret);
  } catch {
    return err("wrong_passphrase");
  } finally {
    key.fill(0);
  }
}
