import { z } from "zod";

/** The engine's answer to a device `open`: a fresh nonce for the device to sign. */
export interface ChallengeFrame {
  readonly t: "challenge";
  /** 32 random bytes in base64url. */
  readonly nonce: string;
}

/** Parses a `challenge` frame. */
export const challengeFrameSchema: z.ZodType<ChallengeFrame> = z.object({
  t: z.literal("challenge"),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
