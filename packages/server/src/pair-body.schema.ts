import type { PairRequest } from "@binference/engine/access";
import { z } from "zod";

const pairBodySchema: z.ZodType<PairRequest> = z.strictObject({
  code: z.string().min(1).max(64),
  publicKey: z.string().min(1).max(512),
  alg: z.enum(["ed25519", "p256"]),
  label: z.string().trim().min(1).max(64),
});

/**
 * Reads the JSON body of `POST /pair`: `{ code, publicKey, alg, label }` and nothing else, the
 * label trimmed to 1 to 64 characters. Text that is not such an object is `undefined`.
 */
export function decodePairBody(text: string): PairRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = pairBodySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
