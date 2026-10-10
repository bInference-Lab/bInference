import type { ProtocolId } from "@binference/protocol";
import { Argument, type Command, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { addressAddFlagsSchema, agentFlagsSchema, commonFlagsSchema } from "./cli-flags.schema.js";
import { agentOption, idOf, withCommon } from "./command-options.js";

/**
 * Adds the address book commands: `address list`, `address add`, which asks for the owner key,
 * and `address remove`.
 */
export function addAddressCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const address = program
    .command("address")
    .description(message("command.address"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(address.command("list").description(message("command.addressList")), message)
    .addOption(agentOption(message))
    .action((flags: OptionValues) =>
      choose({ name: "addressList", options: agentFlagsSchema.parse(flags) }),
    );
  withCommon(address.command("add").description(message("command.addressAdd")), message)
    .addArgument(new Argument("<address>", message("argument.sendAddress")))
    .requiredOption("--label <text>", message("option.label"))
    .addOption(agentOption(message))
    .action((typed: string, flags: OptionValues) =>
      choose({ name: "addressAdd", options: addressAddFlagsSchema.parse(flags), address: typed }),
    );
  withCommon(address.command("remove").description(message("command.addressRemove")), message)
    .addArgument(new Argument("<entry>", message("argument.entry")).argParser(idOf("addressBook")))
    .action((entry: ProtocolId<"addressBook">, flags: OptionValues) =>
      choose({ name: "addressRemove", options: commonFlagsSchema.parse(flags), entry }),
    );
}
