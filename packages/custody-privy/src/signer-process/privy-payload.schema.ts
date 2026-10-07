import { jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { type PrivyRequest, signaturePayload } from "./privy-request.js";

const payloadSchema = z.strictObject({
  version: z.literal(1),
  method: z.literal("POST"),
  url: z.string().min(1).max(2048),
  body: jsonValueSchema,
  headers: z.record(z.string().regex(/^privy-[a-z-]+$/), z.string()),
});

/**
 * Reads back the request an authorization payload covers, as Privy's SDK hands it to a sign
 * function. A payload of another shape, or one whose canonical text is not exactly the payload,
 * is undefined: the signer then signs the same bytes the SDK formed, or nothing.
 */
export function readPayload(payload: Uint8Array): PrivyRequest | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const parsed = payloadSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return undefined;
    }
    const { method, url, body, headers } = parsed.data;
    const request = { method, url, body, headers };
    return signaturePayload(request) === text ? request : undefined;
  } catch {
    return undefined;
  }
}
