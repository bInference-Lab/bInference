import { type ErrorCode, type ErrorDetails, isErrorCode } from "@binference/core";
import { z } from "zod";

/**
 * An error as a `fail` frame carries it. `message` is English for developers and is never shown
 * to the owner: surfaces show the i18n text chosen by `code`.
 */
export interface ProtocolError {
  readonly code: ErrorCode;
  readonly message: string;
  /** Whether the same call may succeed later unchanged. */
  readonly retryable: boolean;
  /** Ids and counts that help find the fault; `internal.error` carries `ref`, the log line. */
  readonly details?: ErrorDetails;
}

/**
 * Parses a dotted error code. Clients accept any well-formed code, so a code added inside a
 * version never breaks an older client.
 */
export const errorCodeSchema: z.ZodType<ErrorCode, string> = z
  .string()
  .refine(isErrorCode, { message: "Expected a dotted error code." });

/** Parses the error of a `fail` frame. */
export const protocolErrorSchema: z.ZodType<ProtocolError> = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).exactOptional(),
});
