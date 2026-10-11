import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { err, ok, type Result } from "@binference/core";

/**
 * A P-256 key pair: the owner key or an agent key. Privy takes both halves in this curve for key
 * quorums and authorization signatures.
 */
export interface P256KeyPair {
  /**
   * The private half. Node keeps its bytes outside the JavaScript heap, and printing, inspecting or
   * serializing it shows no key material.
   */
  readonly privateKey: KeyObject;
  /** The public half as Privy's key quorums take it: DER SubjectPublicKeyInfo in base64. */
  readonly publicKey: string;
}

const curve = "prime256v1";
/** The bytes of a P-256 private scalar. */
export const p256ScalarBytes = 32;

function pairOf(privateKey: KeyObject): P256KeyPair {
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return Object.freeze({ privateKey, publicKey: spki.toString("base64") });
}

/** Makes a new P-256 key pair from the OS CSPRNG, which Node's OpenSSL draws on. */
export function createP256KeyPair(): P256KeyPair {
  return pairOf(generateKeyPairSync("ec", { namedCurve: curve }).privateKey);
}

/** Pairs a private key with its public half. `not_p256` for any other kind of key. */
export function p256KeyPairOf(privateKey: KeyObject): Result<P256KeyPair, "not_p256"> {
  const isP256 =
    privateKey.type === "private" && privateKey.asymmetricKeyDetails?.namedCurve === curve;
  return isP256 ? ok(pairOf(privateKey)) : err("not_p256");
}

/**
 * Rebuilds a key pair from its 32-byte private scalar, big-endian. `invalid_scalar` for a scalar of
 * another length, zero, or not below the curve's order.
 */
export function p256KeyPairFromScalar(scalar: Uint8Array): Result<P256KeyPair, "invalid_scalar"> {
  if (scalar.length !== p256ScalarBytes) {
    return err("invalid_scalar");
  }
  const point = publicPointOf(scalar);
  if (point === undefined) {
    return err("invalid_scalar");
  }
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: Buffer.from(scalar).toString("base64url"),
    x: point.subarray(1, 1 + p256ScalarBytes).toString("base64url"),
    y: point.subarray(1 + p256ScalarBytes).toString("base64url"),
  };
  return ok(pairOf(createPrivateKey({ key: jwk, format: "jwk" })));
}

// The uncompressed public point of a scalar; OpenSSL refuses zero and scalars from the order up.
function publicPointOf(scalar: Uint8Array): Buffer | undefined {
  try {
    const exchange = createECDH(curve);
    exchange.setPrivateKey(scalar);
    return exchange.getPublicKey();
  } catch {
    return undefined;
  }
}

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Reads a P-256 public half written as DER SubjectPublicKeyInfo in base64, such as one
 * `binference owner-key create` printed, and gives it back as Privy takes it: the same encoding,
 * without spaces or line breaks. `not_p256` for text that is no such key, another curve or a
 * private key.
 */
export function parseP256PublicKey(text: string): Result<string, "not_p256"> {
  const compact = text.replaceAll(/\s/g, "");
  if (!base64.test(compact)) {
    return err("not_p256");
  }
  try {
    const key = createPublicKey({
      key: Buffer.from(compact, "base64"),
      format: "der",
      type: "spki",
    });
    const spki = key.export({ type: "spki", format: "der" }).toString("base64");
    const isP256 = key.asymmetricKeyDetails?.namedCurve === curve;
    return isP256 && spki === compact ? ok(spki) : err("not_p256");
  } catch {
    return err("not_p256");
  }
}

/**
 * The 32-byte private scalar of a pair, big-endian. The caller zeroes the buffer once it is done
 * with it.
 */
export function p256ScalarOf(pair: P256KeyPair): Buffer {
  const { d } = pair.privateKey.export({ format: "jwk" });
  return Buffer.from(d ?? "", "base64url");
}
