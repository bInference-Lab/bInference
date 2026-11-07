import { err, jsonValueSchema, ok } from "@binference/core";
import { type WalletView, walletViewSchema } from "@binference/protocol";
import { z } from "zod";
import { chatTopic } from "../chat/chat-relay-parts.js";
import type { AgentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineHandler } from "./engine-call.js";

/** The handler of `turn/deposit` (protocol spec, section 7.7). */
export interface DepositHandlers {
  readonly "turn/deposit": EngineHandler<"turn/deposit">;
}

/** What `turn/deposit` reads and pushes through: the agents, their wallets, the chat topics. */
export interface DepositOptions {
  readonly agents: AgentStore;
  readonly listWallets: EngineHandler<"wallet/list">;
  readonly publish: PublishPush;
}

// A wallet the owner may fund: live, and one the agent runs from, never an extra launch or bridge
// wallet a rebuild adopted.
function isFundable(view: WalletView): boolean {
  return view.archivedAt === undefined && view.extra !== true;
}

/**
 * Creates `turn/deposit` (decision 0380): the agent shows the owner where to send funds. The
 * engine reads the wallets as `wallet/list` answers them, the addresses from custody, never from
 * the agent's words, keeps the one the call names or every one the agent runs from, and pushes
 * them on the agent's chat topic as `chat/deposit` with the agent's mode and freeze, so each
 * surface shows each address and its QR code. An unknown agent is `agent.not_found`; a wallet
 * that is not one the agent runs from, or an agent with none, `wallet.not_found`.
 */
export function createDepositHandlers(options: DepositOptions): DepositHandlers {
  return {
    async "turn/deposit"(call) {
      const { agent, turn, wallet } = call.args;
      const settings = await options.agents.get(agent, call);
      if (settings === undefined) {
        return err("agent.not_found");
      }
      const listed = await options.listWallets({ ...call, args: { agent } });
      if (!listed.ok) {
        return listed;
      }
      const wallets = listed.value.items.filter(
        (view) => isFundable(view) && (wallet === undefined || view.wallet === wallet),
      );
      if (wallets.length === 0) {
        return err("wallet.not_found");
      }
      const { mode, frozenAtMs } = settings.agent;
      const frozen = frozenAtMs !== undefined;
      const encoded = z.array(walletViewSchema).encode(wallets);
      const data = jsonValueSchema.parse({ agent, turn, mode, frozen, wallets: encoded });
      options.publish({ topic: chatTopic(agent), kind: "chat/deposit", data });
      return ok({ wallets });
    },
  };
}
