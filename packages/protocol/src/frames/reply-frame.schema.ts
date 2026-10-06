import { z } from "zod";
import { callIdSchema } from "./call-frame.schema.js";

/** The result of one call, matched to it by `id`. `result` follows the operation's schema. */
export interface ReplyFrame {
  readonly t: "reply";
  readonly id: string;
  readonly result: unknown;
}

/** Parses a `reply` frame. */
export const replyFrameSchema: z.ZodType<ReplyFrame> = z.object({
  t: z.literal("reply"),
  id: callIdSchema,
  result: z.unknown(),
});
