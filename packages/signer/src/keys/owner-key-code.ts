import { createHash, timingSafeEqual } from "node:crypto";
import { createSecret, err, type Result, type Secret } from "@binference/core";
import { decodeBase32, encodeBase32 } from "./base32.js";
import {
  type P256KeyPair,
  p256KeyPairFromScalar,
  p256ScalarBytes,
  p256ScalarOf,
} from "./p256-key-pair.js";

/** Why an owner key code was refused. */
export type OwnerKeyCodeProblem =
  /** It is no code: a wrong prefix, a character outside base32, or a wrong length. */
  | "malformed"
  /** A character is wrong: the checksum does not match the key. */
  | "checksum_mismatch";

const prefix = "bnok1";
const checksumBytes = 4;
const groupLength = 5;

// The first 4 bytes of SHA-256 over the prefix and the scalar. The prefix binds the version, so a
// code of a later version never passes as this one.
function checksumOf(scalar: Uint8Array): Buffer {
  return createHash("sha256").update(prefix).update(scalar).digest().subarray(0, checksumBytes);
}

/**
 * The owner key as the owner keeps it: `bnok1`, then the private scalar and a 4-byte checksum in
 * lowercase base32, in groups of five split by spaces, such as `bnok1abcde fghij ... xyz`. Init
 * shows it once; nothing stores it.
 */
export function formatOwnerKeyCode(pair: P256KeyPair): Secret {
  const scalar = p256ScalarOf(pair);
  const payload = Buffer.concat([scalar, checksumOf(scalar)]);
  try {
    const text = encodeBase32(payload);
    const groups = Array.from({ length: Math.ceil(text.length / groupLength) }, (_, index) =>
      text.slice(index * groupLength, (index + 1) * groupLength),
    );
    return createSecret(`${prefix}${groups.join(" ")}`);
  } finally {
    scalar.fill(0);
    payload.fill(0);
  }
}

/**
 * Reads an owner key code back into the owner key. Spaces, dashes and letter case do not matter.
 * `checksum_mismatch` when a character is wrong; `malformed` when the text is no code, or when a
 * checksum that matches covers a scalar that is no P-256 key.
 */
export function parseOwnerKeyCode(code: Secret): Result<P256KeyPair, OwnerKeyCodeProblem> {
  const compact = code.reveal().replace(/[\s-]/g, "");
  if (compact.slice(0, prefix.length).toLowerCase() !== prefix) {
    return err("malformed");
  }
  const payload = decodeBase32(compact.slice(prefix.length));
  if (payload?.length !== p256ScalarBytes + checksumBytes) {
    return err("malformed");
  }
  const scalar = payload.subarray(0, p256ScalarBytes);
  try {
    if (!timingSafeEqual(checksumOf(scalar), payload.subarray(p256ScalarBytes))) {
      return err("checksum_mismatch");
    }
    const pair = p256KeyPairFromScalar(scalar);
    return pair.ok ? pair : err("malformed");
  } finally {
    payload.fill(0);
  }
}
