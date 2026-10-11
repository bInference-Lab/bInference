import { Argument, type Command, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema, startFlagsSchema } from "./cli-flags.schema.js";
import { addSet, withCommon } from "./command-options.js";

/**
 * Adds the backup commands: `backup create`, a backup now, `backup list`, and `backup restore
 * <file>` on this install, with the `--set` flags of the start after it.
 */
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
  withCommon(backup.command("restore").description(message("command.backupRestore")), message)
    .addArgument(new Argument("<file>", message("argument.backupFile")))
    .option("--set <key=value>", message("option.set"), addSet, [])
    .action((file: string, flags: OptionValues) =>
      choose({ name: "backupRestore", options: startFlagsSchema.parse(flags), file }),
    );
}
