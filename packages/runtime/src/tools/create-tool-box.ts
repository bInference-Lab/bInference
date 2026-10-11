import { BinferenceError } from "@binference/core";
import type { ToolBox } from "../loop/turn-ports.js";
import type { AgentTool } from "./define-tool.js";

// A name the model made up reaches the model again, so only a short, plain one is repeated.
function unknownToolText(name: string): string {
  const shown = /^[\w.-]{1,64}$/.test(name) ? name : "that name";
  return `not run: there is no tool named ${shown}`;
}

/**
 * The tools of an agent's turn: what the model sees, and each call checked by its tool. A call to
 * a name the box does not hold never runs, and the model reads that no such tool exists. Two tools
 * of one name are a fault.
 */
export function createToolBox(tools: readonly AgentTool[]): ToolBox {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  if (byName.size !== tools.length) {
    throw new BinferenceError({
      code: "runtime.tool_name_taken",
      message: "Two tools of the agent share a name.",
    });
  }
  return {
    declarations: tools.map((tool) => tool.declaration),
    prepare(call) {
      const tool = byName.get(call.name);
      return tool === undefined
        ? { ready: false, text: unknownToolText(call.name) }
        : tool.prepare(call.argumentsText);
    },
  };
}
