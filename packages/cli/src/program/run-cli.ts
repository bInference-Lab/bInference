import { BinferenceError } from "@binference/core";
import { createFormatter, type Formatter } from "@binference/i18n";
import type { OwnerInfo } from "@binference/protocol";
import { CommanderError } from "commander";
import { runHealth } from "../commands/health-command.js";
import { runLogs } from "../commands/logs-command.js";
import { runStart } from "../commands/start-command.js";
import { runStatus, signalName } from "../commands/status-command.js";
import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import type { CliHost } from "./cli-host.js";
import { type CliOutput, createCliOutput, type ExitCode } from "./cli-output.js";
import { buildProgram, type ChosenCommand } from "./cli-program.js";
import { systemDefaults } from "./system-defaults.js";

// Commander's codes for a help or version request it already answered.
const answered: ReadonlySet<string> = new Set(["commander.helpDisplayed", "commander.version"]);

// The owner's language and zone from config.json5, else the machine's. A config that does not
// load is the start command's to report; here it only falls back.
async function ownerOf(host: CliHost): Promise<OwnerInfo> {
  const system = systemDefaults(host.env);
  const machine = { locale: system.locale, timezone: system.timezone };
  try {
    const loaded = await loadConfig({
      file: platformOf(host).stateFolder.configFile,
      env: host.env,
      sets: [],
      system,
      signal: new AbortController().signal,
    });
    return loaded.ok ? loaded.config.owner : machine;
  } catch {
    return machine;
  }
}

/** The formatter in the owner's language; UTC when the zone is one `Intl` does not know. */
async function cliFormatter(host: CliHost): Promise<Formatter> {
  const owner = await ownerOf(host);
  try {
    return createFormatter({ locale: owner.locale, timeZone: owner.timezone });
  } catch {
    return createFormatter({ locale: owner.locale, timeZone: "UTC" });
  }
}

const faultMessages: Readonly<Record<string, string>> = {
  "platform.home_not_absolute": "error.homeNotAbsolute",
  "platform.ipc_path_too_long": "error.pathTooLong",
};

function reportFault(output: CliOutput, error: ErrorOptions["cause"]): ExitCode {
  const code = error instanceof BinferenceError ? error.code : "unexpected";
  output.fail({ code, key: faultMessages[code] ?? "error.unexpected", values: { code } });
  return 1;
}

/** What a chosen command runs with. */
interface CommandRun {
  readonly host: CliHost;
  readonly output: CliOutput;
  readonly formatter: Formatter;
}

async function runChosen(chosen: ChosenCommand, context: CommandRun): Promise<ExitCode> {
  const { host, output, formatter } = context;
  if (chosen.name === "start") {
    return runStart(host, output, chosen.options.sets);
  }
  if (chosen.name === "logs") {
    return runLogs(host, output, chosen.options);
  }
  if (chosen.name === "status") {
    const message = (key: string): string => formatter.message(`cli.${key}`);
    return runStatus(host, output, (signal) => signalName(signal, message));
  }
  return runHealth(host, output);
}

async function run(host: CliHost, chosen: ChosenCommand, formatter: Formatter): Promise<ExitCode> {
  const output = createCliOutput({ host, formatter, isJson: chosen.options.json });
  try {
    return await runChosen(chosen, { host, output, formatter });
  } catch (error) {
    return reportFault(output, error);
  }
}

/**
 * Runs the `binference` command for the host's arguments and answers its exit code: 0 done, 1 an
 * error, 2 refused by policy. A command line commander cannot read gets one message in the
 * owner's language; help and the version exit 0.
 */
export async function runCli(host: CliHost): Promise<ExitCode> {
  const formatter = await cliFormatter(host);
  const message = (key: string): string => formatter.message(`cli.${key}`);
  const choice: { chosen?: ChosenCommand } = {};
  const program = buildProgram({
    version: host.version,
    message,
    host,
    choose: (chosen) => {
      choice.chosen = chosen;
    },
  });
  try {
    await program.parseAsync([...host.argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && answered.has(error.code)) {
      return 0;
    }
    // Help asked for with `help`, or shown because no command was given: commander wrote it.
    if (error instanceof CommanderError && error.code === "commander.help") {
      return error.exitCode === 0 ? 0 : 1;
    }
    host.err(`${message("usage.invalid")}\n`);
    return 1;
  }
  return choice.chosen === undefined ? 1 : run(host, choice.chosen, formatter);
}
