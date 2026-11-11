import type { ProtocolId } from "@binference/protocol";
import { Argument, type Command, type OptionValues } from "commander";
import { z } from "zod";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { idOf, withCommon } from "./command-options.js";

function requestArgument(message: ProgramOptions["message"]): Argument {
  return new Argument("<request>", message("argument.shellRequest")).argParser(
    idOf("shellRequest"),
  );
}

// `shell allowed list` and `shell allowed remove <allowed>`.
function addAllowed(shell: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const allowed = shell
    .command("allowed")
    .description(message("command.shellAllowed"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(
    allowed.command("list").description(message("command.shellAllowedList")),
    message,
  ).action((flags: OptionValues) =>
    choose({ name: "shellAllowedList", options: commonFlagsSchema.parse(flags) }),
  );
  withCommon(allowed.command("remove").description(message("command.shellAllowedRemove")), message)
    .addArgument(
      new Argument("<allowed>", message("argument.allowedCommand")).argParser(
        idOf("allowedCommand"),
      ),
    )
    .action((id: ProtocolId<"allowedCommand">, flags: OptionValues) =>
      choose({ name: "shellAllowedRemove", options: commonFlagsSchema.parse(flags), allowed: id }),
    );
}

/**
 * Adds the shell commands (decision 0409): `shell requests`, the agents' commands that wait for the
 * owner's answer; `shell allow <request>`, with `--always` to keep it allowed; `shell refuse
 * <request>`; and `shell allowed list` and `shell allowed remove <allowed>`.
 */
export function addShellCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const shell = program
    .command("shell")
    .description(message("command.shell"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(
    shell.command("requests").description(message("command.shellRequests")),
    message,
  ).action((flags: OptionValues) =>
    choose({ name: "shellRequests", options: commonFlagsSchema.parse(flags) }),
  );
  withCommon(shell.command("allow").description(message("command.shellAllow")), message)
    .addArgument(requestArgument(message))
    .option("--always", message("option.always"))
    .action((request: ProtocolId<"shellRequest">, flags: OptionValues) => {
      const always = z.boolean().optional().parse(flags["always"]) === true;
      choose({
        name: "shellAnswer",
        options: commonFlagsSchema.parse(flags),
        request,
        answer: always ? "always" : "once",
      });
    });
  withCommon(shell.command("refuse").description(message("command.shellRefuse")), message)
    .addArgument(requestArgument(message))
    .action((request: ProtocolId<"shellRequest">, flags: OptionValues) =>
      choose({
        name: "shellAnswer",
        options: commonFlagsSchema.parse(flags),
        request,
        answer: "refuse",
      }),
    );
  addAllowed(shell, options);
}
