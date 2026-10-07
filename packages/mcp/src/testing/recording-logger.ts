import type { McpLogger } from "../server/create-mcp-server.js";

/** One record a {@link RecordingLogger} kept. */
interface LoggedEvent {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly errorCode?: string;
}

/** A logger that keeps its records for a test to read. */
export interface RecordingLogger extends McpLogger {
  readonly records: readonly LoggedEvent[];
}

/** A logger that keeps every record, with its error code, and writes nowhere. */
export function createRecordingLogger(): RecordingLogger {
  const records: LoggedEvent[] = [];
  const write =
    (level: LoggedEvent["level"]) =>
    (event: string, fields?: { readonly errorCode?: string }): void => {
      records.push({
        level,
        event,
        ...(fields?.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
      });
    };
  const logger: RecordingLogger = {
    records,
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: () => logger,
  };
  return logger;
}
