import {
  type AuthorizeInput,
  authorizeInputSchema,
  type AuthorizeInputWire,
  type SignerRefusal,
  signerRefusalSchema,
} from "@binference/chain";
import { z } from "zod";

/** Asks for the agent key's public half. */
export interface PublicKeyRequest {
  readonly id: string;
  readonly kind: "publicKey";
}

/** Asks for Privy's authorization signature over one request (keys spec, section 5.1). */
export interface AuthorizeRequest extends AuthorizeInput {
  readonly id: string;
  readonly kind: "authorize";
}

/** A request to the signer. Every message carries an `id` its answer repeats. */
export type SignerRequest = PublicKeyRequest | AuthorizeRequest;

/**
 * The signer's answer to one request. A refused line that held no readable id is answered with
 * `id: null`.
 */
export type SignerAnswer =
  | { readonly id: string; readonly ok: true; readonly publicKey: string }
  | { readonly id: string; readonly ok: true; readonly signature: string }
  | { readonly id: string | null; readonly ok: false; readonly refused: SignerRefusal };

/**
 * Why the signer process stops: it runs outside Node's permission model, its settings or its
 * agent key are invalid, or a line on its input is over the limit. It writes the fault as its last
 * line and exits with code 1.
 */
export type SignerFaultCode =
  | "signer.not_sealed"
  | "signer.settings_invalid"
  | "signer.agent_key_invalid"
  | "signer.line_too_long";

/** The line a signer writes before it stops on a fault. */
export interface SignerFault {
  readonly fault: SignerFaultCode;
}

/** A line the signer writes: an answer, or the fault it stops on. */
export type SignerLine = SignerAnswer | SignerFault;

const messageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const base64Schema = z.string().regex(/^[A-Za-z0-9+/]{4,1024}={0,2}$/);

/** Parses a line the signer wrote. */
const signerLineSchema: z.ZodType<SignerLine, SignerLine> = z.union([
  z.strictObject({ id: messageIdSchema, ok: z.literal(true), publicKey: base64Schema }),
  z.strictObject({ id: messageIdSchema, ok: z.literal(true), signature: base64Schema }),
  z.strictObject({
    id: messageIdSchema.nullable(),
    ok: z.literal(false),
    refused: signerRefusalSchema,
  }),
  z.strictObject({
    fault: z.enum([
      "signer.not_sealed",
      "signer.settings_invalid",
      "signer.agent_key_invalid",
      "signer.line_too_long",
    ]),
  }),
]);

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Reads a line the signer wrote; `undefined` for a line that is neither an answer nor a fault. */
export function readSignerLine(line: string): SignerLine | undefined {
  const parsed = signerLineSchema.safeParse(parseJson(line));
  return parsed.success ? parsed.data : undefined;
}

const envelopeSchema = z.looseObject({ id: messageIdSchema, kind: z.string() });

/** A request line as the signer read it: the request, or why it refuses the line. */
export type RequestReading =
  | { readonly ok: true; readonly request: SignerRequest }
  | { readonly ok: false; readonly id: string | null; readonly refused: SignerRefusal };

function requestOf(
  id: string,
  kind: string,
  fields: Readonly<Record<string, unknown>>,
): RequestReading {
  if (kind === "publicKey") {
    return Object.keys(fields).length === 0
      ? { ok: true, request: { id, kind } }
      : { ok: false, id, refused: "malformed" };
  }
  if (kind !== "authorize") {
    return { ok: false, id, refused: "unknown_request" };
  }
  const input = authorizeInputSchema.safeParse(fields);
  return input.success
    ? { ok: true, request: { id, kind, ...input.data } }
    : { ok: false, id, refused: "malformed" };
}

/**
 * Reads one request line. A line that is not a JSON object with an id is an unknown request
 * answered with `id: null`; a kind other than `publicKey` and `authorize` is an unknown request; a
 * known kind that breaks its schema is malformed.
 */
export function readSignerRequest(line: string): RequestReading {
  const envelope = envelopeSchema.safeParse(parseJson(line));
  if (!envelope.success) {
    return { ok: false, id: null, refused: "unknown_request" };
  }
  const { id, kind, ...fields } = envelope.data;
  return requestOf(id, kind, fields);
}

/** Writes a request as the line the signer reads, without its newline. */
export function formatSignerRequest(request: SignerRequest): string {
  if (request.kind === "publicKey") {
    return JSON.stringify({ id: request.id, kind: request.kind });
  }
  const { id, kind, ...input } = request;
  const wire: AuthorizeInputWire = z.encode(authorizeInputSchema, input);
  return JSON.stringify({ id, kind, ...wire });
}
