import type { Command, OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

/** Adds the backup commands: `backup create`, a backup now, and `backup list`. */
export function addBackupCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const backup = program
    .command("backup")
    .description(message("command.backup"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(backup.command("create").description(message("command.backupCreate")), message).action(
    (flags: OptionValues) =>
      choose({ name: "backupCreate", options: commonFlagsSchema.parse(flags) }),
  );
  withCommon(backup.command("list").description(message("command.backupList")), message).action(
    (flags: OptionValues) =>
      choose({ name: "backupList", options: commonFlagsSchema.parse(flags) }),
  );
}
