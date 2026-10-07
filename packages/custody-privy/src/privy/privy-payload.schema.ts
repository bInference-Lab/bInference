import { authorizationPayload, type PrivyRequest, privyRequestSchema } from "@binference/chain";
import { z } from "zod";

// Version 1 of Privy's payload over a POST; `privyRequestSchema` reads the rest, and the byte
// check below refuses any field it would not write.
const payloadSchema = z.looseObject({
  version: z.literal(1),
  method: z.literal("POST"),
  url: z.unknown(),
  headers: z.unknown(),
  body: z.unknown(),
});

function parsedJson(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return undefined;
  }
}

/**
 * Reads back the request an authorization payload covers, as Privy's SDK hands it to a sign
 * function: a `POST` that `privyRequestSchema` accepts, whose bytes are exactly those
 * `authorizationPayload` writes for it. Anything else is undefined: the signer then signs the
 * bytes the SDK formed, or nothing.
 */
export function readPayload(payload: Uint8Array): PrivyRequest | undefined {
  const parsed = payloadSchema.safeParse(parsedJson(payload));
  if (!parsed.success) {
    return undefined;
  }
  const { method, url, headers, body } = parsed.data;
  const request = privyRequestSchema.safeParse({ method, url, headers, body });
  return request.success && authorizationPayload(request.data).equals(payload)
    ? request.data
    : undefined;
}
