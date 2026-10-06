import { z } from "zod";

/** A console device's answer to `challenge`: its signature over `deviceProofText`. */
export interface ProveFrame {
  readonly t: "prove";
  /** 64 bytes in base64url: an Ed25519 signature, or ECDSA P-256 as WebCrypto writes it. */
  readonly signature: string;
}

/** Parses a `prove` frame. */
export const proveFrameSchema: z.ZodType<ProveFrame> = z.object({
  t: z.literal("prove"),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
