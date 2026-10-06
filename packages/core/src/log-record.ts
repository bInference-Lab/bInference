/** How much a log record matters: `error` needs a person, `info` is a state change. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** The ids a log record may carry. Content never goes in a log. */
export interface LogFields {
  readonly agentId?: string;
  readonly intentId?: string;
  readonly orderId?: string;
  readonly traceId?: string;
  readonly chain?: string;
  readonly errorCode?: string;
  readonly durationMs?: number;
}

/** One record as a logger writes it. */
export interface LogRecord {
  readonly level: LogLevel;
  readonly subsystem: string;
  readonly event: string;
  readonly fields: LogFields;
}
