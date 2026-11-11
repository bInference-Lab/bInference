import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { Argument, type Command, InvalidArgumentError, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { agentFlagsSchema, commonFlagsSchema } from "./cli-flags.schema.js";
import { agentOption, withCommon } from "./command-options.js";
import { skillProposalsFlagsSchema, skillRejectFlagsSchema } from "./skill-flags.schema.js";

function proposalOf(value: string): ProtocolId<"skillProposal"> {
  const parsed = protocolIdSchema("skillProposal").safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError(`${value} is not a skill proposal id.`);
  }
  return parsed.data;
}

function proposalArgument(message: ProgramOptions["message"]): Argument {
  return new Argument("<proposal>", message("argument.skillProposal")).argParser(proposalOf);
}

/**
 * Adds the skill review commands (decision 0408): `skill proposals`, `skill show <proposal>`,
 * `skill apply <proposal>`, `skill reject <proposal>` and `skill accept <name>`.
 */
export function addSkillCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const skill = program
    .command("skill")
    .description(message("command.skill"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(skill.command("proposals").description(message("command.skillProposals")), message)
    .addOption(agentOption(message))
    .option("--all", message("option.skillAll"))
    .action((flags: OptionValues) =>
      choose({ name: "skillProposals", options: skillProposalsFlagsSchema.parse(flags) }),
    );
  for (const [verb, name] of [
    ["show", "skillShow"],
    ["apply", "skillApply"],
  ] as const) {
    withCommon(skill.command(verb).description(message(`command.${name}`)), message)
      .addArgument(proposalArgument(message))
      .action((proposal: ProtocolId<"skillProposal">, flags: OptionValues) =>
        choose({ name, options: commonFlagsSchema.parse(flags), proposal }),
      );
  }
  withCommon(skill.command("reject").description(message("command.skillReject")), message)
    .addArgument(proposalArgument(message))
    .option("--reason <text>", message("option.skillReason"))
    .action((proposal: ProtocolId<"skillProposal">, flags: OptionValues) =>
      choose({ name: "skillReject", options: skillRejectFlagsSchema.parse(flags), proposal }),
    );
  withCommon(skill.command("accept").description(message("command.skillAccept")), message)
    .addArgument(new Argument("<name>", message("argument.skillName")))
    .addOption(agentOption(message))
    .action((name: string, flags: OptionValues) =>
      choose({ name: "skillAccept", options: agentFlagsSchema.parse(flags), skill: name }),
    );
}
