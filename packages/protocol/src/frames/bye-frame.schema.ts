import type { ErrorCode } from "@binference/core";
import { z } from "zod";
import { errorCodeSchema } from "../errors/protocol-error.js";

/**
 * The engine's last frame before it closes the socket, such as `protocol.not_open` when the first
 * frame is not `open`, or an `auth` code when sign-in fails.
 */
export interface ByeFrame {
  readonly t: "bye";
  readonly code: ErrorCode;
  /** English for developers; surfaces show the i18n text chosen by `code`. */
  readonly message: string;
}

/** Parses a `bye` frame. */
export const byeFrameSchema: z.ZodType<ByeFrame> = z.object({
  t: z.literal("bye"),
  code: errorCodeSchema,
  message: z.string(),
});
