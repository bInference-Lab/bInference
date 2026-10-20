import type { AgentView, AssetInfos, WalletView } from "@binference/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { type HoldingSection, holdingSections } from "./portfolio-sections";

// What the portfolio screen shows of one agent once it has loaded.
interface AgentPortfolio {
  readonly sections: readonly HoldingSection[];
  /** The assets the balances name. */
  readonly assets: AssetInfos;
  /** The agent's wallets by id; empty when they could not be read. */
  readonly wallets: ReadonlyMap<string, WalletView>;
}

/** One agent's portfolio, or why it could not load; neither while it loads. */
export interface PortfolioQuery {
  readonly portfolio?: AgentPortfolio;
  readonly error: Error | null;
}

/**
 * Reads an agent's balances and its wallets' labels. The balances sit under the `portfolio` key,
 * which a ledger push makes stale.
 */
export function usePortfolio(agent: AgentView["agent"]): PortfolioQuery {
  const { client } = useEngine();
  const holdings = useQuery({
    queryKey: ["portfolio", "get", agent],
    queryFn: async ({ signal }) => client.call("portfolio/get", { agent }, { signal }),
  });
  const wallets = useQuery({
    queryKey: ["wallets", agent],
    queryFn: async ({ signal }) => client.call("wallet/list", { agent }, { signal }),
  });
  if (holdings.data === undefined) {
    return { error: holdings.error };
  }
  const portfolio = {
    sections: holdingSections(holdings.data),
    assets: holdings.data.assets,
    wallets: new Map((wallets.data?.items ?? []).map((wallet) => [wallet.wallet, wallet])),
  };
  return { portfolio, error: holdings.error };
}
