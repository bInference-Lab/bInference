import { z } from "zod";
import { type ProtocolError, protocolErrorSchema } from "../errors/protocol-error.js";
import { callIdSchema } from "./call-frame.schema.js";

/** The error that ends one call, matched to it by `id`. */
export interface FailFrame {
  readonly t: "fail";
  readonly id: string;
  readonly error: ProtocolError;
}

/** Parses a `fail` frame. */
export const failFrameSchema: z.ZodType<FailFrame> = z.object({
  t: z.literal("fail"),
  id: callIdSchema,
  error: protocolErrorSchema,
});
