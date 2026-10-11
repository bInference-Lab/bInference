import { Buffer } from "node:buffer";
import { createCipheriv, createECDH, type ECDH, hkdfSync } from "node:crypto";
import { BinferenceError } from "@binference/core";

/** The browser's keys a push message is encrypted to, as its subscription gives them. */
export interface PushReceiverKeys {
  /** The browser's P-256 public key, uncompressed, in base64url. */
  readonly p256dh: string;
  /** The browser's 16-byte authentication secret, in base64url. */
  readonly auth: string;
}

/** What one message's encryption takes fresh: a 16-byte salt and a new P-256 key pair. */
export interface PushSenderParts {
  readonly salt: Readonly<Uint8Array>;
  /** An ECDH key pair on `prime256v1` made for this message alone. */
  readonly sender: ECDH;
}

// RFC 8188: one record holds the whole message, so its size is the header's record size.
const recordSize = 4096;
const tagLength = 16;
const pointLength = 65;
const saltLength = 16;
const secretLength = 16;
// The plaintext, its delimiter octet and the tag must fit one record.
const maxPlaintextBytes = recordSize - tagLength - 1;
const lastRecordDelimiter = 0x02;

function invalidKeys(): BinferenceError {
  return new BinferenceError({
    code: "web_push.bad_keys",
    message: "The subscription's keys are not a P-256 point and a 16-byte secret.",
  });
}

function decodeKeys(keys: PushReceiverKeys): { readonly point: Buffer; readonly secret: Buffer } {
  const point = Buffer.from(keys.p256dh, "base64url");
  const secret = Buffer.from(keys.auth, "base64url");
  if (point.length !== pointLength || point[0] !== 0x04 || secret.length !== secretLength) {
    throw invalidKeys();
  }
  return { point, secret };
}

// HKDF-SHA-256 from one input key and salt (RFC 5869), as each key of RFC 8291 is derived.
function deriveFrom(ikm: Uint8Array, salt: Readonly<Uint8Array>) {
  return (info: Uint8Array, length: number): Buffer =>
    Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

function label(text: string): Buffer {
  return Buffer.concat([Buffer.from(text, "latin1"), Buffer.of(0)]);
}

function header(salt: Readonly<Uint8Array>, senderPoint: Uint8Array): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(recordSize);
  return Buffer.concat([salt, size, Buffer.of(senderPoint.length), senderPoint]);
}

/** Makes the fresh parts of one message: a random salt from the caller and a new key pair. */
export function newPushSenderParts(salt: Readonly<Uint8Array>): PushSenderParts {
  const sender = createECDH("prime256v1");
  sender.generateKeys();
  return { salt, sender };
}

/**
 * Encrypts a push message to a browser as RFC 8291 sets out, in one `aes128gcm` record of
 * RFC 8188: the header (salt, record size 4096, the sender's public key), then the plaintext with
 * its delimiter octet, sealed with AES-128-GCM under keys derived from the ECDH secret and the
 * browser's authentication secret. Throws `web_push.bad_keys` for keys that are not a P-256 point
 * and a 16-byte secret, and `web_push.too_large` past 4,079 bytes of plaintext.
 */
export function encryptPushMessage(
  plaintext: Readonly<Uint8Array>,
  keys: PushReceiverKeys,
  parts: PushSenderParts,
): Uint8Array {
  if (plaintext.length > maxPlaintextBytes || parts.salt.length !== saltLength) {
    throw new BinferenceError({
      code: "web_push.too_large",
      message: `A push message holds at most ${String(maxPlaintextBytes)} bytes in one record.`,
    });
  }
  const { point, secret } = decodeKeys(keys);
  const senderPoint = parts.sender.getPublicKey();
  const shared = parts.sender.computeSecret(point);
  const keyInfo = Buffer.concat([label("WebPush: info"), point, senderPoint]);
  const ikm = deriveFrom(shared, secret)(keyInfo, 32);
  const derive = deriveFrom(ikm, parts.salt);
  const cek = derive(label("Content-Encoding: aes128gcm"), 16);
  const nonce = derive(label("Content-Encoding: nonce"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.of(lastRecordDelimiter)])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return new Uint8Array(Buffer.concat([header(parts.salt, senderPoint), sealed]));
}
