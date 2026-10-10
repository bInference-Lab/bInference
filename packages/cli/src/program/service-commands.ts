import type { Command, OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

/**
 * Adds `service remove`: stops binference and takes its background service off login (decision
 * 0141).
 */
export function addServiceCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const service = program
    .command("service")
    .description(message("command.service"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(
    service.command("remove").description(message("command.serviceRemove")),
    message,
  ).action((flags: OptionValues) =>
    choose({ name: "serviceRemove", options: commonFlagsSchema.parse(flags) }),
  );
}
