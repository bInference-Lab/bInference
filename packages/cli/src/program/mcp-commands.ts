import { type Command, Option, type OptionValues } from "commander";
import { mcpClients } from "../compose/mcp-token.js";
import type { ProgramOptions } from "./chosen-command.js";
import { withCommon } from "./command-options.js";
import { mcpFlagsSchema } from "./mcp-flags.schema.js";

/**
 * Adds `binference mcp`, the MCP server an MCP client starts, signed in with that client's token
 * (protocol spec, section 11; decision 0154).
 */
export function addMcpCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  withCommon(program.command("mcp").description(message("command.mcp")), message)
    .addOption(new Option("--client <name>", message("option.mcpClient")).choices(mcpClients))
    .action((flags: OptionValues) => choose({ name: "mcp", options: mcpFlagsSchema.parse(flags) }));
}
