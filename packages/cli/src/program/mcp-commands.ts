import { tokenLifetimeMaxMs } from "@binference/protocol";
import { type Command, Option, type OptionValues } from "commander";
import { mcpClients } from "../compose/mcp-token.js";
import type { ProgramOptions } from "./chosen-command.js";
import { ttlOption, withCommon } from "./command-options.js";
import {
  mcpFlagsSchema,
  mcpSessionFlagsSchema,
  mcpSetupFlagsSchema,
  sessionTtlMaxMs,
} from "./mcp-flags.schema.js";

/**
 * Adds `binference mcp`, the MCP server an MCP client starts, signed in with that client's token,
 * `binference mcp setup`, which sets a client up, and `binference mcp session`, which starts a
 * client once with a token of its own (protocol spec, section 11; decisions 0154 and 0159).
 */
export function addMcpCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const mcp = withCommon(program.command("mcp").description(message("command.mcp")), message)
    .addOption(new Option("--client <name>", message("option.mcpClient")).choices(mcpClients))
    .enablePositionalOptions()
    .helpCommand("help [command]", message("option.help"))
    .action((flags: OptionValues) => choose({ name: "mcp", options: mcpFlagsSchema.parse(flags) }));
  withCommon(mcp.command("setup").description(message("command.mcpSetup")), message)
    .addOption(
      new Option("--client <name>", message("option.mcpSetupClient"))
        .choices(mcpClients)
        .makeOptionMandatory(),
    )
    .option("--dry-run", message("option.dryRun"))
    .option("--remove", message("option.mcpRemove"))
    .addOption(ttlOption(message("option.mcpSetupTtl"), tokenLifetimeMaxMs).conflicts("remove"))
    .action((flags: OptionValues) =>
      choose({ name: "mcpSetup", options: mcpSetupFlagsSchema.parse(flags) }),
    );
  withCommon(mcp.command("session").description(message("command.mcpSession")), message)
    .addOption(
      new Option("--client <name>", message("option.mcpSessionClient"))
        .choices(mcpClients)
        .makeOptionMandatory(),
    )
    .addOption(ttlOption(message("option.mcpSessionTtl"), sessionTtlMaxMs))
    .option("--print-config", message("option.printConfig"))
    .argument("[clientArgs...]", message("argument.clientArgs"))
    .action((clientArgs: readonly string[], flags: OptionValues) =>
      choose({
        name: "mcpSession",
        options: mcpSessionFlagsSchema.parse({ ...flags, clientArgs }),
      }),
    );
}
