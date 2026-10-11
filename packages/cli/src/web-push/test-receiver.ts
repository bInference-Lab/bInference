import { Buffer } from "node:buffer";
import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  type ECDH,
  hkdfSync,
  verify,
} from "node:crypto";
import { BinferenceError, type JsonValue, jsonValueSchema } from "@binference/core";
import type { PushReceiverKeys } from "./encrypt-push-message.js";

/** A browser's side of push messages in tests: its subscription keys, and how it opens a message. */
export interface TestReceiver {
  readonly keys: PushReceiverKeys;
  /**
   * Opens an `aes128gcm` message to these keys and answers its text (RFC 8291); a request
   * without a body of bytes throws.
   */
  open(body: Readonly<Uint8Array> | undefined): string;
  /** Opens a message as `open` does and parses its JSON. */
  openJson(body: Readonly<Uint8Array> | undefined): JsonValue;
}

function label(text: string): Buffer {
  return Buffer.concat([Buffer.from(text, "latin1"), Buffer.of(0)]);
}

function openWith(receiver: ECDH, auth: Buffer, body: Readonly<Uint8Array> | undefined): string {
  if (body === undefined) {
    throw new BinferenceError({ code: "test.no_body", message: "The request carries no bytes." });
  }
  const message = Buffer.from(body);
  const salt = message.subarray(0, 16);
  const keyLength = message[20] ?? 0;
  const senderPoint = message.subarray(21, 21 + keyLength);
  const info = Buffer.concat([label("WebPush: info"), receiver.getPublicKey(), senderPoint]);
  const ikm = hkdfSync("sha256", receiver.computeSecret(senderPoint), auth, info, 32);
  const cek = hkdfSync("sha256", ikm, salt, label("Content-Encoding: aes128gcm"), 16);
  const nonce = hkdfSync("sha256", ikm, salt, label("Content-Encoding: nonce"), 12);
  const decipher = createDecipheriv("aes-128-gcm", Buffer.from(cek), Buffer.from(nonce));
  decipher.setAuthTag(message.subarray(-16));
  const padded = Buffer.concat([
    decipher.update(message.subarray(21 + keyLength, -16)),
    decipher.final(),
  ]);
  return padded.subarray(0, padded.lastIndexOf(0x02)).toString("utf8");
}

/**
 * A browser's push keys for a test: a P-256 key pair and an authentication secret, given or new.
 */
export function createTestReceiver(given?: {
  readonly privateKey: string;
  readonly auth: string;
}): TestReceiver {
  const receiver = createECDH("prime256v1");
  if (given === undefined) {
    receiver.generateKeys();
  } else {
    receiver.setPrivateKey(Buffer.from(given.privateKey, "base64url"));
  }
  const auth = given === undefined ? Buffer.alloc(16, 9) : Buffer.from(given.auth, "base64url");
  return {
    keys: {
      p256dh: receiver.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    },
    open: (body) => openWith(receiver, auth, body),
    openJson: (body) => readJson(openWith(receiver, auth, body)),
  };
}

function readJson(text: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(text));
}

function decodePart(part: string): JsonValue {
  return readJson(Buffer.from(part, "base64url").toString());
}

/** A `vapid` authorization as a push service reads it: whether it verifies, and what it says. */
export interface CheckedVapid {
  readonly valid: boolean;
  readonly header: JsonValue;
  readonly claims: JsonValue;
  /** The public key the header names, in base64url. */
  readonly key: string;
}

function publicKeyOf(point: Buffer) {
  return createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
}

/**
 * Checks a `vapid t=<JWT>, k=<key>` authorization as a push service does (RFC 8292): the ES256
 * signature with the key it names, and the token's header and claims.
 */
export function checkVapidAuthorization(header: string): CheckedVapid {
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  const [, head = "", body = "", signature = "", key = ""] = match ?? [];
  const valid = verify(
    "sha256",
    Buffer.from(`${head}.${body}`),
    { key: publicKeyOf(Buffer.from(key, "base64url")), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  return { valid, header: decodePart(head), claims: decodePart(body), key };
}
