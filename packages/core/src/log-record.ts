/** How much a log record matters: `error` needs a person, `info` is a state change. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** The ids a log record may carry. Content never goes in a log. */
export interface LogFields {
  readonly agentId?: string;
  readonly intentId?: string;
  readonly orderId?: string;
  readonly traceId?: string;
  readonly chain?: string;
  /** An asset's CAIP-19 id, such as the token a price watcher flags. */
  readonly assetId?: string;
  /** An account's CAIP-10 id, such as a tracked wallet the leader watcher cut a block of. */
  readonly accountId?: string;
  /** A data source's or venue's id, such as `dexscreener`. */
  readonly sourceId?: string;
  readonly errorCode?: string;
  readonly durationMs?: number;
  /** A gap between two prices, in basis points. */
  readonly gapBps?: number;
}

/** One record as a logger writes it. */
export interface LogRecord {
  readonly level: LogLevel;
  readonly subsystem: string;
  readonly event: string;
  readonly fields: LogFields;
}
