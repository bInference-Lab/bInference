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
  /** A message's id in the owner's chat, such as one a reply went out as. */
  readonly messageId?: number;
  /** An outbound request's HTTP method, such as `GET`. */
  readonly method?: string;
  /** An outbound request's host, such as `api.example.com`; never its path or query. */
  readonly host?: string;
  /** The HTTP status an answer came with. */
  readonly status?: number;
  /** An MCP listing's id, `mls_…` (decision 0428). */
  readonly listing?: string;
  /** A listed MCP server's state for an agent: `resting`, `off` or `ok`. */
  readonly state?: string;
  /** Why a listing is refused, rests or has a tool off, as a code such as `changed`. */
  readonly reason?: string;
}

/** One record as a logger writes it. */
export interface LogRecord {
  readonly level: LogLevel;
  readonly subsystem: string;
  readonly event: string;
  readonly fields: LogFields;
}
