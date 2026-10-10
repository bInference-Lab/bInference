import type { Command, OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

/** Adds the owner's bot's commands: `telegram pair`, a new pairing link (decision 0139). */
export function addTelegramCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const telegram = program
    .command("telegram")
    .description(message("command.telegram"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(telegram.command("pair").description(message("command.telegramPair")), message).action(
    (flags: OptionValues) =>
      choose({ name: "telegramPair", options: commonFlagsSchema.parse(flags) }),
  );
}
