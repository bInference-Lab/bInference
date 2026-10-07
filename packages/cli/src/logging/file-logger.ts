import {
  type Clock,
  type LogFields,
  type Logger,
  type LogLevel,
  redactSecrets,
} from "@binference/core";
import type { LogFile } from "@binference/platform";
import { type ILogObjMeta, type IMeta, Logger as TslogLogger } from "tslog";
import { type LogLine, logFieldsSchema } from "./log-line.schema.js";

/** The engine's logger, which writes JSON lines to its log file. */
export interface EngineLogger extends Logger {
  /** Writes every line logged so far, then closes the log file. */
  close(): Promise<void>;
}

/** Where the engine's logger writes, from which level, and by which clock. */
export interface FileLoggerOptions {
  readonly file: Pick<LogFile, "append" | "close">;
  /** The lowest level written, from config `logging.level`. */
  readonly level: LogLevel;
  readonly clock: Clock;
  /** The root subsystem, such as `engine`. */
  readonly subsystem: string;
}

/** A record as the logger hands it to tslog: the event, then the fields. */
interface Entry {
  readonly 0?: string;
  readonly 1?: LogFields;
}

type Tslog = TslogLogger<Entry>;

const levelIds: Readonly<Record<LogLevel, number>> = { debug: 2, info: 3, warn: 4, error: 5 };
const levelNames: Readonly<Record<string, LogLevel>> = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
};

function fieldsOf(value: LogFields | undefined): LogFields | undefined {
  const parsed = logFieldsSchema.safeParse(value);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
}

function subsystemOf(meta: IMeta): string {
  return [...(meta.parentNames ?? []), meta.name ?? ""].join(".");
}

/**
 * One JSON line from a record. The whole line passes through `redactSecrets`, so a secret in an
 * event or a field never reaches the file.
 */
function lineOf(record: Entry & ILogObjMeta): string {
  const meta: IMeta = record["_logMeta"] ?? {
    date: new Date(0),
    logLevelId: 0,
    logLevelName: "",
    runtime: "",
  };
  const fields = fieldsOf(record[1]);
  const line: LogLine = {
    time: meta.date.toISOString(),
    level: levelNames[meta.logLevelName] ?? "error",
    subsystem: subsystemOf(meta),
    event: record[0] ?? "",
    ...(fields === undefined ? {} : { fields }),
  };
  return redactSecrets(JSON.stringify(line));
}

function wrap(tslog: Tslog): Logger {
  return {
    debug: (event, fields) => tslog.debug(event, fields ?? {}),
    info: (event, fields) => tslog.info(event, fields ?? {}),
    warn: (event, fields) => tslog.warn(event, fields ?? {}),
    error: (event, fields) => tslog.error(event, fields ?? {}),
    child: (part) => wrap(tslog.getSubLogger({ name: part })),
  };
}

/**
 * Creates the engine's logger: the `Logger` port on tslog, writing one JSON line per record to the
 * log file. Records below `level` are dropped. Lines carry ids only, and every line is redacted,
 * so a key, a recovery phrase or a token never reaches the file.
 */
export function createFileLogger(options: FileLoggerOptions): EngineLogger {
  const tslog: Tslog = new TslogLogger<Entry>({
    type: "hidden",
    name: options.subsystem,
    minLevel: levelIds[options.level],
    clock: () => new Date(options.clock.now()),
    stack: { capture: "off" },
  });
  tslog.attachTransport({
    name: "file",
    format: lineOf,
    write: (_record, line) => options.file.append(line),
  });
  return {
    ...wrap(tslog),
    async close() {
      await tslog.flush();
      await options.file.close();
    },
  };
}
