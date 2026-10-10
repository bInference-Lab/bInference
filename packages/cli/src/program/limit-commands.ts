import { Argument, type Command, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { agentFlagsSchema } from "./cli-flags.schema.js";
import { agentOption, withCommon } from "./command-options.js";

/**
 * Adds the limit commands (decision 0111): `limit` shows the agent's limits, `limit set` changes
 * them, and `limit cancel` drops the looser ones that wait.
 */
export function addLimitCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const limit = withCommon(program.command("limit").description(message("command.limit")), message)
    .addOption(agentOption(message))
    .enablePositionalOptions()
    .helpCommand("help [command]", message("option.help"))
    .action((flags: OptionValues) =>
      choose({ name: "limit", options: agentFlagsSchema.parse(flags) }),
    );
  withCommon(limit.command("set").description(message("command.limitSet")), message)
    .addArgument(new Argument("<sets...>", message("argument.limitSets")))
    .addOption(agentOption(message))
    .action((sets: readonly string[], flags: OptionValues) =>
      choose({ name: "limitSet", options: agentFlagsSchema.parse(flags), sets }),
    );
  withCommon(limit.command("cancel").description(message("command.limitCancel")), message)
    .addOption(agentOption(message))
    .action((flags: OptionValues) =>
      choose({ name: "limitCancel", options: agentFlagsSchema.parse(flags) }),
    );
}
