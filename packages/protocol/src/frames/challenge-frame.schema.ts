import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/**
 * The engine's answer to a device `open`: a fresh nonce for the device to sign, and the connection
 * it signs it for.
 */
export interface ChallengeFrame {
  readonly t: "challenge";
  /** 32 random bytes in base64url. */
  readonly nonce: string;
  /** The connection's id, as `ready` will name it; the proof binds it. */
  readonly connection?: ProtocolId<"connection">;
}

/** Parses a `challenge` frame. */
export const challengeFrameSchema: z.ZodType<ChallengeFrame> = z.object({
  t: z.literal("challenge"),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  connection: protocolIdSchema("connection").exactOptional(),
});
