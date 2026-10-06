import { redactSecrets } from "../errors/redact-secrets.js";
import type { LogFields, LogLevel, LogRecord } from "../log-record.js";
import type { Logger } from "../ports.js";

/** A logger for tests that keeps its records in memory. */
export interface MemoryLogger extends Logger {
  /** The records so far, oldest first, across this logger and its children. */
  readonly records: () => readonly LogRecord[];
}

/** What a {@link MemoryLogger} starts with. */
export interface MemoryLoggerOptions {
  readonly subsystem: string;
  /** The most records kept; the oldest is dropped first. */
  readonly maxRecords?: number;
}

interface RecordSink {
  add(record: LogRecord): void;
  list(): readonly LogRecord[];
}

function createRecordSink(maxRecords: number): RecordSink {
  const records: LogRecord[] = [];
  return {
    add(record) {
      records.push(record);
      if (records.length > maxRecords) {
        records.shift();
      }
    },
    list: () => [...records],
  };
}

function redactFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]: readonly [string, string | number]) => [
      key,
      typeof value === "string" ? redactSecrets(value) : value,
    ]),
  );
}

function createChild(subsystem: string, sink: RecordSink): MemoryLogger {
  const write =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}): void => {
      sink.add({ level, subsystem, event: redactSecrets(event), fields: redactFields(fields) });
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (part: string) => createChild(`${subsystem}.${part}`, sink),
    records: () => sink.list(),
  };
}

/** Creates a {@link MemoryLogger} that redacts secrets as a real adapter must. */
export function createMemoryLogger(options: MemoryLoggerOptions): MemoryLogger {
  return createChild(options.subsystem, createRecordSink(options.maxRecords ?? 1_000));
}
