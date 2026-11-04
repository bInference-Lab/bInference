import { Argument, type Command, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";
import { pluginAddFlagsSchema } from "./plugin-flags.schema.js";

/**
 * Adds the plugin commands: `plugin add <source>` with its permission review, `plugin list`, and
 * `plugin enable`, `disable` and `remove <name>`.
 */
export function addPluginCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const plugin = program
    .command("plugin")
    .description(message("command.plugin"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(plugin.command("add").description(message("command.pluginAdd")), message)
    .addArgument(new Argument("<source>", message("argument.pluginSource")))
    .option("--hash <integrity>", message("option.pluginHash"))
    .option("--name <name>", message("option.pluginName"))
    .action((source: string, flags: OptionValues) =>
      choose({ name: "pluginAdd", options: pluginAddFlagsSchema.parse(flags), source }),
    );
  withCommon(plugin.command("list").description(message("command.pluginList")), message).action(
    (flags: OptionValues) =>
      choose({ name: "pluginList", options: commonFlagsSchema.parse(flags) }),
  );
  for (const [name, key] of [
    ["enable", "pluginEnable"],
    ["disable", "pluginDisable"],
    ["remove", "pluginRemove"],
  ] as const) {
    withCommon(plugin.command(name).description(message(`command.${key}`)), message)
      .addArgument(new Argument("<name>", message("argument.pluginName")))
      .action((named: string, flags: OptionValues) =>
        choose({ name: key, options: commonFlagsSchema.parse(flags), plugin: named }),
      );
  }
}
