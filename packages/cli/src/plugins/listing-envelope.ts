import { createHash, type KeyObject, verify } from "node:crypto";
import {
  err,
  jsonShapeProblem,
  jsonValueSchema,
  type JsonValue,
  maxJsonDepth,
  ok,
  type Result,
  stableJson,
} from "@binference/core";
import { z } from "zod";
import { base64urlBytes } from "./base64url-bytes.js";
import type { ListingKeys } from "./listing-keys.js";

/** What an envelope's signature covers: one plugin listing, or the revocation list. */
export type ListingKind = "pluginListing" | "pluginRevocations";

/** The most a payload holds, in bytes, by its kind (decision 0434). */
export const payloadLimits: Readonly<Record<ListingKind, number>> = {
  pluginListing: 64 * 1024,
  pluginRevocations: 1024 * 1024,
};

/** A payload whose envelope verified: its JSON, its SHA-256 in hex, and the key that signed it. */
export interface OpenedPayload {
  readonly payload: JsonValue;
  readonly digest: string;
  readonly key: string;
}

interface Envelope {
  readonly key: string;
  readonly payload: string;
  readonly signature: string;
}

const signatureBytes = 64;
// The envelope's own text around its payload: its keys, quotes, the key's id and the signature.
const envelopeOverhead = 256;
const domain = new TextEncoder().encode("binference-listing-v1");
// A byte-order mark stays in the text, so a payload that starts with one is not canonical.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const envelopeSchema: z.ZodType<Envelope> = z.strictObject({
  key: z.string().regex(/^[0-9a-f]{32}$/),
  payload: z.string(),
  signature: z.string(),
});

/**
 * The statement a listing key signs for one payload (decision 0434): `binference-listing-v1`, a
 * zero byte, the kind, a zero byte, the key's id, a zero byte, then the payload's SHA-256.
 */
export function listingStatement(
  kind: ListingKind,
  keyId: string,
  payload: Uint8Array,
): Uint8Array {
  const zero = Uint8Array.of(0);
  const digest = createHash("sha256").update(payload).digest();
  return new Uint8Array(
    Buffer.concat([
      domain,
      zero,
      Buffer.from(kind, "ascii"),
      zero,
      Buffer.from(keyId, "ascii"),
      zero,
      digest,
    ]),
  );
}

// The envelope's fields, once its text fits and reads as one flat object with no key twice.
function envelopeOf(text: string, kind: ListingKind): Envelope | undefined {
  const most = envelopeOverhead + Math.ceil((payloadLimits[kind] * 4) / 3);
  if (text.length > most || jsonShapeProblem(text, 1) !== undefined) {
    return undefined;
  }
  try {
    const read = envelopeSchema.safeParse(JSON.parse(text));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}

function isSigned(statement: Uint8Array, key: KeyObject, signature: Uint8Array): boolean {
  try {
    return verify(null, statement, key, signature);
  } catch {
    return false;
  }
}

// The payload's JSON, when its bytes are UTF-8 and the one canonical form of what they hold.
function canonicalPayload(bytes: Uint8Array): JsonValue | undefined {
  try {
    const text = utf8.decode(bytes);
    if (jsonShapeProblem(text, maxJsonDepth) !== undefined) {
      return undefined;
    }
    const read = jsonValueSchema.safeParse(JSON.parse(text));
    return read.success && stableJson(read.data) === text ? read.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens a signed envelope of the listing catalog (decision 0434) for the kind the caller asked
 * for. The bounds come before any work: the envelope's text, then its base64url texts, then the
 * payload's bytes. The signature must be exactly 64 bytes, the key it names must be in force and
 * no other key is tried, and `crypto.verify` checks it over the statement before the payload is
 * read; the payload must then be UTF-8 written in its canonical form. Anything else is
 * `unverified`.
 */
export function openEnvelope(
  text: string,
  expected: { readonly kind: ListingKind; readonly keys: ListingKeys },
): Result<OpenedPayload, "unverified"> {
  const envelope = envelopeOf(text, expected.kind);
  const key = envelope === undefined ? undefined : expected.keys.keyOf(envelope.key);
  if (envelope === undefined || key === undefined) {
    return err("unverified");
  }
  const payload = base64urlBytes(envelope.payload, payloadLimits[expected.kind]);
  const signature = base64urlBytes(envelope.signature, signatureBytes);
  if (payload === undefined || signature?.length !== signatureBytes) {
    return err("unverified");
  }
  const statement = listingStatement(expected.kind, envelope.key, payload);
  const read = isSigned(statement, key, signature) ? canonicalPayload(payload) : undefined;
  if (read === undefined) {
    return err("unverified");
  }
  const digest = createHash("sha256").update(payload).digest("hex");
  return ok({ payload: read, digest, key: envelope.key });
}
