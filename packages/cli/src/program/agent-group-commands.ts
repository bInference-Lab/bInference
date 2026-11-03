import type { Command, OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { agentIdentityFlagsSchema } from "./cli-flags.schema.js";
import { agentOption, withCommon } from "./command-options.js";

/** Adds the `agent` commands: `agent identity`, which shows or opens the agent's on-chain identity. */
export function addAgentGroupCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const agent = program
    .command("agent")
    .description(message("command.agent"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(agent.command("identity").description(message("command.agentIdentity")), message)
    .option("--description <text>", message("option.identityDescription"))
    .addOption(agentOption(message))
    .action((flags: OptionValues) =>
      choose({ name: "agentIdentity", options: agentIdentityFlagsSchema.parse(flags) }),
    );
}
