import { jsonValueSchema } from "@binference/core";
import { protocolIdSchema } from "@binference/protocol";
import { z } from "zod";
import type { RuntimePlugin, RuntimePluginTool } from "../control/runtime-settings.schema.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrFailure } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/**
 * The name the agent calls a community plugin's tool by (decision 0348): the plugin's id with
 * its hyphens as underscores, two underscores, then the tool's own name. No tool of binference's
 * holds two underscores in a row.
 */
export function pluginToolName(id: string, tool: string): string {
  return `${id.replaceAll("-", "_")}__${tool}`;
}

// What the manifest's input schema reads, as zod reads it; one zod cannot read is no tool. A pipe
// would let a field the schema refuses through, stripped, so the input is read as JSON in the run.
function argsOf(input: RuntimePluginTool["input"]): z.ZodType | undefined {
  try {
    return z.fromJSONSchema(input);
  } catch {
    return undefined;
  }
}

function toolOf(
  parts: AgentToolParts,
  plugin: RuntimePlugin,
  tool: RuntimePluginTool,
): AgentTool | undefined {
  const args = argsOf(tool.input);
  if (args === undefined) {
    return undefined;
  }
  const name = pluginToolName(plugin.id, tool.name);
  const call = {
    agent: parts.agent,
    plugin: protocolIdSchema("installedPlugin").parse(plugin.plugin),
    tool: tool.name,
  };
  try {
    return defineTool({
      name,
      kind: "read",
      parallel: true,
      outside: true,
      description: `From the community plugin ${plugin.id}: ${tool.description}`,
      args,
      run: async (input, { signal }) => {
        // The input the schema took, as the JSON the engine's call carries.
        const json = jsonValueSchema.safeParse(input);
        if (!json.success) {
          return { text: `${name} takes JSON input only.`, isError: true };
        }
        return answerOrFailure(name, async () => {
          const answer = await parts.client.call(
            "plugin/call",
            { ...call, input: json.data },
            { signal },
          );
          return { text: JSON.stringify(answer.output), isError: false };
        });
      },
    });
  } catch {
    // A schema the tool rules refuse, such as one that lets an object take fields it does not
    // name, gives the agent no tool; the engine still checks every call's input.
    return undefined;
  }
}

/**
 * The tools of the agent's enabled community plugins (decision 0349): each a `read` that may run
 * beside other reads, named `<id>__<tool>`, its description led by the plugin's id, its input
 * checked with the schema its manifest declares, and its answer `plugin/call` gives as JSON.
 * Every result is outside content, so the turn that reads one is marked. A tool whose schema
 * zod or the tool rules cannot read, or whose name an earlier tool took, is left out.
 */
export function pluginTools(
  parts: AgentToolParts,
  plugins: readonly RuntimePlugin[],
): readonly AgentTool[] {
  const named = new Map<string, AgentTool>();
  for (const plugin of plugins) {
    for (const tool of plugin.tools) {
      const made = toolOf(parts, plugin, tool);
      if (made !== undefined && !named.has(made.name)) {
        named.set(made.name, made);
      }
    }
  }
  return [...named.values()];
}
