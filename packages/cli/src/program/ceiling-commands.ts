import { type Command, Option, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { ceilingSetFlagsSchema, walletAddressFlagsSchema } from "./cli-flags.schema.js";
import { agentOption, idOf, withCommon } from "./command-options.js";

// `--venues a,b`: each venue between the commas, blanks left out.
function venuesOf(value: string): readonly string[] {
  return value
    .split(",")
    .map((venue) => venue.trim())
    .filter((venue) => venue.length > 0);
}

function walletOption(message: (key: string) => string): Option {
  return new Option("--wallet <id>", message("option.wallet")).argParser(idOf("wallet"));
}

/**
 * Adds the ceiling commands (decisions 0110, 0132 and 0151): `ceiling` shows a wallet's ceiling,
 * and `ceiling set` changes, with the owner key, the venues and the cap of every wallet of the
 * agent, or the 24-hour caps every wallet shares.
 */
export function addCeilingCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const ceiling = withCommon(
    program.command("ceiling").description(message("command.ceiling")),
    message,
  )
    .addOption(agentOption(message))
    .addOption(walletOption(message))
    .enablePositionalOptions()
    .helpCommand("help [command]", message("option.help"))
    .action((flags: OptionValues) =>
      choose({ name: "ceiling", options: walletAddressFlagsSchema.parse(flags) }),
    );
  withCommon(ceiling.command("set").description(message("command.ceilingSet")), message)
    .addOption(agentOption(message))
    .addOption(walletOption(message))
    .option("--venues <ids>", message("option.venues"), venuesOf)
    .option("--per-tx <amount>", message("option.perTx"))
    .option("--day-cap-usd <dollars>", message("option.dayCapUsd"))
    .action((flags: OptionValues) =>
      choose({ name: "ceilingSet", options: ceilingSetFlagsSchema.parse(flags) }),
    );
}
