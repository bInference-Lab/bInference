import { err, ok } from "@binference/core";
import type { AgentView } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { WalletRecord } from "../install/install-record.js";
import type { AgentStore, InstallStore } from "../ports.js";
import { agentViewOf } from "./agent-view-of.js";
import type { EngineHandler } from "./engine-call.js";
import { walletViewOf, type WalletViewParts } from "./wallet-view-of.js";

/** The handler of `agent/list` (protocol spec, section 7.2). */
export interface AgentListHandlers {
  readonly "agent/list": EngineHandler<"agent/list">;
}

/** What the agent list reads: the agents, the install's wallets and custody for each address. */
export interface AgentListOptions extends WalletViewParts {
  readonly agents: AgentStore;
  readonly install: InstallStore;
}

const defaultPageSize = 50;

interface Listed {
  readonly agent: AgentRecord;
  readonly wallets: readonly WalletRecord[];
}

async function listedView(
  options: AgentListOptions,
  { agent, wallets }: Listed,
  signal: AbortSignal,
): Promise<AgentView> {
  const view = agentViewOf(agent);
  const live = wallets.filter(
    (wallet) => wallet.agentId === agent.id && wallet.archivedAtMs === undefined,
  );
  const first = live.find((wallet) => wallet.role === undefined);
  const launch = live.find((wallet) => wallet.role === "launch");
  const [defaultWallet, launchWallet] = await Promise.all(
    [first, launch].map(async (wallet) =>
      wallet === undefined ? undefined : walletViewOf(options, wallet, signal),
    ),
  );
  return {
    ...view,
    ...(defaultWallet === undefined ? {} : { defaultWallet }),
    ...(launchWallet === undefined ? {} : { launchWallet }),
  };
}

/**
 * Creates the agent list. `agent/list` pages through every agent, archived ones too, oldest
 * first, each with its default wallet: its oldest wallet not archived that is no launch wallet,
 * which a proposal uses when it names none; and its live launch wallet (decision 0217). The cursor is the last agent's id of the page before; an unknown one is
 * `protocol.bad_args`.
 */
export function createAgentListHandlers(options: AgentListOptions): AgentListHandlers {
  return {
    async "agent/list"({ args, signal }) {
      const agents = await options.agents.list({ signal });
      const start =
        args.cursor === undefined ? 0 : agents.findIndex((agent) => agent.id === args.cursor) + 1;
      if (args.cursor !== undefined && start === 0) {
        return err("protocol.bad_args");
      }
      const limit = args.limit ?? defaultPageSize;
      const page = agents.slice(start, start + limit);
      const { wallets } = await options.install.read({ signal });
      const items = await Promise.all(
        page.map(async (agent) => listedView(options, { agent, wallets }, signal)),
      );
      const last = page.at(-1);
      return ok(
        start + limit < agents.length && last !== undefined ? { items, next: last.id } : { items },
      );
    },
  };
}
