import { Argument, type Command, Option, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { agentFlagsSchema, commonFlagsSchema } from "./cli-flags.schema.js";
import { idOf, withCommon } from "./command-options.js";

// `freeze` and `unfreeze` act on every agent and the install unless `--agent` names one.
function addFreezeCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  for (const name of ["freeze", "unfreeze"] as const) {
    withCommon(program.command(name).description(message(`command.${name}`)), message)
      .addOption(new Option("--agent <id>", message("option.agentOrAll")).argParser(idOf("agent")))
      .action((flags: OptionValues) => choose({ name, options: agentFlagsSchema.parse(flags) }));
  }
}

// `rescue` opens the rescue card; `rescue set` changes the address it pays.
function addRescueCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const rescue = withCommon(
    program.command("rescue").description(message("command.rescue")),
    message,
  )
    .enablePositionalOptions()
    .helpCommand("help [command]", message("option.help"))
    .action((flags: OptionValues) =>
      choose({ name: "rescue", options: commonFlagsSchema.parse(flags) }),
    );
  withCommon(rescue.command("set").description(message("command.rescueSet")), message)
    .addArgument(new Argument("<address>", message("argument.address")))
    .action((address: string, flags: OptionValues) =>
      choose({ name: "rescueSet", options: commonFlagsSchema.parse(flags), address }),
    );
}

/**
 * Adds the safety commands (ARCHITECTURE.md section 11): `freeze`, `unfreeze`, `rescue`,
 * `rescue set` and `safety status`.
 */
export function addSafetyCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  addFreezeCommands(program, options);
  addRescueCommands(program, options);
  const safety = program
    .command("safety")
    .description(message("command.safety"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(safety.command("status").description(message("command.safetyStatus")), message).action(
    (flags: OptionValues) =>
      choose({ name: "safetyStatus", options: commonFlagsSchema.parse(flags) }),
  );
}
