import type { WalletView } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

const refusals: Readonly<Record<string, string>> = {
  "wallet.not_found":
    "This agent has no wallet the owner can fund yet. Tell the owner; `binference wallet create` in the terminal makes one.",
};

// What a wallet is for, as the model reads it.
function roleOf(view: WalletView): string {
  if (view.role === "launch") {
    return "launch";
  }
  return view.bridge === true ? "bridge" : "agent";
}

// A wallet as the model reads it: its label, role and chain, and its address as the chain writes it.
function lineOf(view: WalletView): string {
  const at = view.address.lastIndexOf(":");
  const chain = view.chainName ?? view.address.slice(0, at);
  return `${view.label} (${roleOf(view)} wallet, ${chain}): ${view.address.slice(at + 1)}`;
}

/**
 * `deposit_address`, a control tool (decision 0380): the engine shows the owner, in the chat of
 * the turn, each wallet the agent runs from with its address and the QR code of it, read from
 * custody. The model names no wallet and writes no address: the tool answers the addresses the
 * engine showed, which the agent may repeat as they are.
 */
export function depositTool({ agent, client, turn }: AgentToolParts): AgentTool {
  return defineTool({
    name: "deposit_address",
    kind: "control",
    addressSource: "engine",
    description: agentToolTexts.deposit_address,
    args: z.strictObject({}),
    run: async (_args, { signal }) =>
      answerOrRefusal({ tool: "deposit_address", refusals }, async () => {
        const shown = await client.call("turn/deposit", { agent, turn: turn.turn }, { signal });
        const text = [
          "The owner now sees each of these wallets in this chat, with its address and its QR code:",
          ...shown.wallets.map(lineOf),
        ].join("\n");
        return { text, isError: false };
      }),
  });
}
