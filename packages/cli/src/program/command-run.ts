import type { Formatter } from "@binference/i18n";
import type { CliHost } from "./cli-host.js";
import type { CliOutput } from "./cli-output.js";

/** What a chosen command runs with: its host, its output, and the owner's formatter for times. */
export interface CommandRun {
  readonly host: CliHost;
  readonly output: CliOutput;
  readonly formatter: Formatter;
}
