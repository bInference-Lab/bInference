import type { JsonValue } from "@binference/core";
import type { Formatter, MessageValues } from "@binference/i18n";
import type { CliHost } from "./cli-host.js";

/** How a command ends: 0 done, 1 an error, 2 refused by policy (ENGINEERING section 24.5). */
export type ExitCode = 0 | 1 | 2;

/**
 * What a command prints. People get messages in the owner's language; with `--json`, scripts get
 * one JSON value per line on standard output and no message at all.
 */
export interface CliOutput {
  /** The message under a `cli.` key, on its own line; nothing with `--json`. */
  say(key: string, values?: MessageValues): void;
  /** The message under a `cli.` key as an indented item of a list; nothing with `--json`. */
  item(key: string, values?: MessageValues): void;
  /** A line written as it is, such as a log line; nothing with `--json`. */
  line(text: string): void;
  /** One JSON value on its own line; only with `--json`. */
  json(value: JsonValue): void;
  /**
   * An error or a refusal: the message on standard error, or `{"error":{"code":...}}` with the
   * details on standard output with `--json`.
   */
  fail(failure: CliFailure): void;
  /** A message that explains a failure, on standard error; nothing with `--json`. */
  explain(key: string, values?: MessageValues): void;
}

/** One failure: its code for scripts, its message for people. */
interface CliFailure {
  /** A dotted code, such as `engine.not_running`. */
  readonly code: string;
  readonly key: string;
  readonly values?: MessageValues;
  /** More for scripts, such as each config issue. */
  readonly details?: JsonValue;
}

/** Where a command's output goes, in which language, and whether it is JSON. */
export interface CliOutputOptions {
  readonly host: Pick<CliHost, "out" | "err">;
  readonly formatter: Formatter;
  /** `--json`: one JSON value per line for scripts, and no messages. */
  readonly isJson: boolean;
}

/** The output of one command run, in the formatter's language. */
export function createCliOutput(options: CliOutputOptions): CliOutput {
  const { host, formatter, isJson } = options;
  const message = (key: string, values?: MessageValues): string =>
    formatter.message(`cli.${key}`, values);
  return {
    say(key, values) {
      if (!isJson) {
        host.out(`${message(key, values)}\n`);
      }
    },
    item(key, values) {
      if (!isJson) {
        host.out(`  ${message(key, values)}\n`);
      }
    },
    line(text) {
      if (!isJson) {
        host.out(`${text}\n`);
      }
    },
    json(value) {
      if (isJson) {
        host.out(`${JSON.stringify(value)}\n`);
      }
    },
    fail(failure) {
      if (isJson) {
        const details = failure.details === undefined ? {} : { details: failure.details };
        host.out(`${JSON.stringify({ error: { code: failure.code, ...details } })}\n`);
      } else {
        host.err(`${message(failure.key, failure.values)}\n`);
      }
    },
    explain(key, values) {
      if (!isJson) {
        host.err(`${message(key, values)}\n`);
      }
    },
  };
}
