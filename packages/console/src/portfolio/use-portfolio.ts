import type { AgentView, AssetInfos, WalletView } from "@binference/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { type HoldingSection, holdingSections } from "./portfolio-sections";

// What the portfolio screen shows of one agent once it has loaded.
interface AgentPortfolio {
  readonly sections: readonly HoldingSection[];
  /** The assets the balances and the cards name, merged. */
  readonly assets: AssetInfos;
  /** The agent's wallets by id; empty when they could not be read. */
  readonly wallets: ReadonlyMap<string, WalletView>;
}

/** One agent's portfolio, or why it could not load; neither while it loads. */
export interface PortfolioQuery {
  readonly portfolio?: AgentPortfolio;
  readonly error: Error | null;
}

// The screen shows the positions closed in the last 7 days, as `/positions` does (spec 4, section 5).
const closedWindowMs = 7 * 24 * 60 * 60 * 1_000;

/**
 * Reads an agent's balances, its P&L cards with those closed in the last 7 days, and its wallets'
 * labels. The queries sit under the `portfolio` key, which a ledger push makes stale.
 */
export function usePortfolio(agent: AgentView["agent"]): PortfolioQuery {
  const { client } = useEngine();
  const holdings = useQuery({
    queryKey: ["portfolio", "get", agent],
    queryFn: async ({ signal }) => client.call("portfolio/get", { agent }, { signal }),
  });
  const pnl = useQuery({
    queryKey: ["portfolio", "pnl", agent],
    queryFn: async ({ signal }) => {
      const to = Date.now();
      const range = { from: Math.max(0, to - closedWindowMs), to };
      return client.call("portfolio/pnl", { agent, ...range, cards: true }, { signal });
    },
  });
  const wallets = useQuery({
    queryKey: ["wallets", agent],
    queryFn: async ({ signal }) => client.call("wallet/list", { agent }, { signal }),
  });
  const error = holdings.error ?? pnl.error;
  if (holdings.data === undefined || pnl.data === undefined) {
    return { error };
  }
  const portfolio = {
    sections: holdingSections(holdings.data, pnl.data.cards ?? []),
    assets: { ...holdings.data.assets, ...pnl.data.assets },
    wallets: new Map((wallets.data?.items ?? []).map((wallet) => [wallet.wallet, wallet])),
  };
  return { portfolio, error };
}
