import { Argument, type Command, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema, configSetFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

/**
 * Adds the config commands (decision 0208): `config get [key]` shows the config as it loads, and
 * `config set <key> [value]` changes one key in config.json5 through the engine.
 */
export function addConfigCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const config = program
    .command("config")
    .description(message("command.config"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(config.command("get").description(message("command.configGet")), message)
    .addArgument(new Argument("[key]", message("argument.configKey")))
    .action((key: string | undefined, flags: OptionValues) => {
      const common = commonFlagsSchema.parse(flags);
      choose(
        key === undefined
          ? { name: "configGet", options: common }
          : { name: "configGet", options: common, key },
      );
    });
  withCommon(config.command("set").description(message("command.configSet")), message)
    .addArgument(new Argument("<key>", message("argument.configKey")))
    .addArgument(new Argument("[value]", message("argument.configValue")))
    .option("--from-env <variable>", message("option.fromEnv"))
    .option("--from-keychain <name>", message("option.fromKeychain"))
    .option("--reason <text>", message("option.reason"))
    .action((key: string, value: string | undefined, flags: OptionValues) => {
      const set = configSetFlagsSchema.parse(flags);
      choose(
        value === undefined
          ? { name: "configSet", options: set, key }
          : { name: "configSet", options: set, key, value },
      );
    });
}
