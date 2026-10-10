import { Argument, type Command, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { withCommon } from "./command-options.js";

/**
 * Adds `signer revoke <signer>`: removes a machine's agent key from every wallet with the owner
 * key (keys spec, section 6; decision 0140).
 */
export function addSignerCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const signer = program
    .command("signer")
    .description(message("command.signer"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(signer.command("revoke").description(message("command.signerRevoke")), message)
    .addArgument(new Argument("<signer>", message("argument.signer")))
    .action((id: string, flags: OptionValues) =>
      choose({ name: "signerRevoke", options: commonFlagsSchema.parse(flags), signer: id }),
    );
}
