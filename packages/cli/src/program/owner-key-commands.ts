import type { Command, OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

/**
 * Adds `owner-key create`: makes an owner key on a machine with a terminal, for an install set up
 * where nobody sees one, which then takes its public half (keys spec, section 2; decision 0148).
 */
export function addOwnerKeyCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const ownerKey = program
    .command("owner-key")
    .description(message("command.ownerKey"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(
    ownerKey.command("create").description(message("command.ownerKeyCreate")),
    message,
  ).action((flags: OptionValues) =>
    choose({ name: "ownerKeyCreate", options: commonFlagsSchema.parse(flags) }),
  );
}
