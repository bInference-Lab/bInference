import type { LogFields, LogLevel } from "@binference/core";
import { z } from "zod";

/** One line of the engine log, as JSON: what `binference logs` reads back. */
export interface LogLine {
  /** When it was written, as an ISO 8601 time in UTC. */
  readonly time: string;
  readonly level: LogLevel;
  /** Such as `engine.server`. */
  readonly subsystem: string;
  /** Such as `server.listening`. */
  readonly event: string;
  /** The ids the record carries; left out when it carries none. */
  readonly fields?: LogFields;
}

/** Parses the ids of one log record. */
export const logFieldsSchema: z.ZodType<LogFields> = z.strictObject({
  agentId: z.string().exactOptional(),
  intentId: z.string().exactOptional(),
  orderId: z.string().exactOptional(),
  traceId: z.string().exactOptional(),
  chain: z.string().exactOptional(),
  errorCode: z.string().exactOptional(),
  durationMs: z.number().exactOptional(),
});

/** Parses one line of the engine log. */
export const logLineSchema: z.ZodType<LogLine> = z.strictObject({
  time: z.iso.datetime(),
  level: z.enum(["debug", "info", "warn", "error"]),
  subsystem: z.string().min(1),
  event: z.string().min(1),
  fields: logFieldsSchema.exactOptional(),
});
