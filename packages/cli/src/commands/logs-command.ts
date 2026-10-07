import { jsonValueSchema } from "@binference/core";
import { type Platform, readLogLines } from "@binference/platform";
import { engineLogFile, platformOf } from "../compose/engine-locations.js";
import { type LogLine, logLineSchema } from "../logging/log-line.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";

/** What `binference logs` shows. */
export interface LogsOptions {
  /** How many of the last lines to show first. */
  readonly lines: number;
  /** Keep showing new lines until a stop signal. */
  readonly follow: boolean;
}

/** One followed log file. */
interface Following {
  readonly host: CliHost;
  readonly output: CliOutput;
  readonly file: string;
  readonly platform: Platform;
}

// A log line is a few hundred bytes; a tail reads at most 4 MiB.
const bytesPerLine = 2_048;
const maxTailBytes = 4 * 1024 * 1024;
const followEveryMs = 500;
const maxFollowBytes = 1024 * 1024;

function parsed(text: string): LogLine | undefined {
  try {
    const line = logLineSchema.safeParse(JSON.parse(text));
    return line.success ? line.data : undefined;
  } catch {
    return undefined;
  }
}

/** One log line as a person reads it: time, level, subsystem, event, then the ids. */
export function formatLogLine(line: LogLine): string {
  const fields = Object.entries(line.fields ?? {}).map(
    ([name, value]: readonly [string, string | number]) => ` ${name}=${String(value)}`,
  );
  return `${line.time} ${line.level.padEnd(5)} ${line.subsystem} ${line.event}${fields.join("")}`;
}

function show(output: CliOutput, lines: readonly string[]): void {
  for (const text of lines) {
    const line = parsed(text);
    if (line === undefined) {
      output.line(text);
    } else {
      output.json(jsonValueSchema.parse(JSON.parse(text)));
      output.line(formatLogLine(line));
    }
  }
}

// Reads what the file gained since `from`, every half second, until the signal stops it.
async function followFrom(following: Following, from: number, stop: AbortSignal): Promise<void> {
  await following.host.clock.sleep(followEveryMs, stop).catch(() => undefined);
  if (stop.aborted) {
    return;
  }
  const read = await readLogLines(following.file, { from, maxBytes: maxFollowBytes, signal: stop });
  if (read.ok) {
    show(following.output, read.value.lines);
  }
  await followFrom(following, read.ok ? read.value.next : from, stop);
}

async function follow(following: Following, start: number): Promise<void> {
  const { host, platform } = following;
  const stopped = new AbortController();
  const onStop = (): void => stopped.abort();
  platform.stopSignals.forEach((name) => host.signals.on(name, onStop));
  try {
    await followFrom(following, start, stopped.signal);
  } finally {
    platform.stopSignals.forEach((name) => host.signals.off(name, onStop));
  }
}

/**
 * `binference logs`: prints the last lines of the engine's log file, each as a person reads it or
 * as JSON, and with `--follow` the new lines every half second until a stop signal. Reads the
 * file, so it works while the engine is stopped. Exits 1 when there is no log yet.
 */
export async function runLogs(
  host: CliHost,
  output: CliOutput,
  options: LogsOptions,
): Promise<ExitCode> {
  const platform = platformOf(host);
  const file = engineLogFile(platform);
  const maxBytes = Math.min(options.lines * bytesPerLine, maxTailBytes);
  const tail = await readLogLines(file, { maxBytes, signal: new AbortController().signal });
  if (!tail.ok) {
    output.fail({ code: "logs.not_found", key: "logs.none", values: { file } });
    return 1;
  }
  show(output, tail.value.lines.slice(-options.lines));
  if (options.follow) {
    await follow({ host, output, file, platform }, tail.value.next);
  }
  return 0;
}
