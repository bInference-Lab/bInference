import type { AgentMode, WalletView } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrFailure } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** What a wallet is for: the agent's own trades and sends, a launch's curve, or a bridge's deposit. */
type WalletRole = "agent" | "launch" | "bridge";

/** One wallet as `wallets` answers it. */
interface ShownWallet {
  readonly wallet: string;
  readonly label: string;
  readonly role: WalletRole;
  /** A live launch or bridge wallet beyond the agent's own of that role: nothing runs from it. */
  readonly extra?: true;
  readonly chainName?: string;
  /** The address as its chain writes it, such as `0x…` on BNB Smart Chain. */
  readonly address: string;
  /** The same address as a CAIP-10 account id, its chain first. */
  readonly account: string;
}

/** What `wallets` answers: the agent's mode, which every wallet of it trades in, and its wallets. */
interface WalletsAnswer {
  readonly mode: AgentMode;
  readonly wallets: readonly ShownWallet[];
}

function roleOf(view: WalletView): WalletRole {
  if (view.role === "launch") {
    return "launch";
  }
  return view.bridge === true ? "bridge" : "agent";
}

// A CAIP-10 account id ends with its address, after the chain's two parts.
function shownOf(view: WalletView): ShownWallet {
  return {
    wallet: view.wallet,
    label: view.label,
    role: roleOf(view),
    ...(view.extra === true ? { extra: true } : {}),
    ...(view.chainName === undefined ? {} : { chainName: view.chainName }),
    address: view.address.slice(view.address.lastIndexOf(":") + 1),
    account: view.address,
  };
}

/**
 * `wallets`, a read tool (runtime spec, section 5.1): this agent's wallets through `wallet/list`,
 * with the mode `agent/get` reads, each wallet's address, chain and role, and no balance, which
 * `portfolio` reads. An archived wallet is left out. The engine holds these wallets for the agent,
 * so the answer is never outside content.
 */
export function walletsTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "wallets",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.wallets,
    args: z.strictObject({}),
    run: async (_args, { signal }) =>
      answerOrFailure("wallets", async () => {
        const [view, page] = await Promise.all([
          client.call("agent/get", { agent }, { signal }),
          client.call("wallet/list", { agent }, { signal }),
        ]);
        const wallets = page.items.filter((item) => item.archivedAt === undefined).map(shownOf);
        const answer: WalletsAnswer = { mode: view.mode, wallets };
        return { text: JSON.stringify(answer), isError: false };
      }),
  });
}
