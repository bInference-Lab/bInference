import { BinferenceError } from "@binference/core";
import type { ModelMessage } from "../loop/model-message.js";
import type { ToolBox } from "../loop/ports.js";
import type { PreparedCall } from "../loop/turn-records.js";
import type { AgentTool } from "./define-tool.js";
import { type AddressTools, noteAddressRefusal, noteOnlyAddress } from "./note-addresses.js";

// A name the model made up reaches the model again, so only a short, plain one is repeated.
function unknownToolText(name: string): string {
  const shown = /^[\w.-]{1,64}$/.test(name) ? name : "that name";
  return `not run: there is no tool named ${shown}`;
}

function addressToolsOf(tools: readonly AgentTool[]): AddressTools {
  const named = (source: AgentTool["addressSource"]): ReadonlySet<string> =>
    new Set(tools.filter((tool) => tool.addressSource === source).map((tool) => tool.name));
  return { engine: named("engine"), notes: named("note") };
}

// A proposal that passed its schema still takes no address only a note holds (decision 0206).
function checkedProposal(
  prepared: PreparedCall,
  argumentsText: string,
  context: { readonly seen: readonly ModelMessage[]; readonly tools: AddressTools },
): PreparedCall {
  if (!prepared.ready || prepared.kind !== "propose") {
    return prepared;
  }
  const address = noteOnlyAddress(argumentsText, context.seen, context.tools);
  return address === undefined ? prepared : { ready: false, text: noteAddressRefusal(address) };
}

/**
 * The tools of an agent's turn: what the model sees, and each call checked by its tool. A call to
 * a name the box does not hold never runs, and the model reads that no such tool exists. A
 * proposal with an address that only a note in the conversation holds never runs either
 * (decision 0206). Two tools of one name are a fault.
 */
export function createToolBox(tools: readonly AgentTool[]): ToolBox {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  if (byName.size !== tools.length) {
    throw new BinferenceError({
      code: "runtime.tool_name_taken",
      message: "Two tools of the agent share a name.",
    });
  }
  const addressTools = addressToolsOf(tools);
  return {
    declarations: tools.map((tool) => tool.declaration),
    prepare(call, seen = []) {
      const tool = byName.get(call.name);
      if (tool === undefined) {
        return { ready: false, text: unknownToolText(call.name) };
      }
      const prepared = tool.prepare(call.argumentsText);
      return checkedProposal(prepared, call.argumentsText, { seen, tools: addressTools });
    },
  };
}
