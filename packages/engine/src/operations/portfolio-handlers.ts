import type { Amount, ChainRegistry } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { ArgsOf, ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";
import {
  createMarketHandlers,
  type MarketHandlers,
  type MarketParts,
} from "../market/market-handlers.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { PaperPortfolio } from "../paper/paper-portfolio.js";
import type { AgentStore, InstallStore } from "../ports.js";
import { activeAgent } from "./active-agent.js";
import { type AssetSearchHandlers, createAssetSearchHandlers } from "./asset-search-handlers.js";
import type { EngineHandler } from "./engine-call.js";
import { type LiveHoldingsOptions, liveHoldingsOf } from "./live-holdings.js";
import { pnlViewOf } from "./pnl-view.js";
import { paperHoldingsOf, portfolioViewOf } from "./portfolio-view.js";

/**
 * The handlers of `portfolio/get`, `portfolio/pnl`, `portfolio/resetPaper`, `asset/search`,
 * `market/scan` and `market/chart` (protocol spec, section 7.3).
 */
export interface PortfolioHandlers extends AssetSearchHandlers, MarketHandlers {
  readonly "portfolio/get": EngineHandler<"portfolio/get">;
  readonly "portfolio/pnl": EngineHandler<"portfolio/pnl">;
  readonly "portfolio/resetPaper": EngineHandler<"portfolio/resetPaper">;
}

/** What the portfolio handlers read and reset through. */
export interface PortfolioHandlersOptions extends LiveHoldingsOptions, MarketParts {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  readonly portfolio: PaperPortfolio;
}

// A missing price is a feed the engine could not read now, such as the native coin's.
const resetErrors: Readonly<Record<"no_wallet" | "no_price", ProtocolErrorCode>> = {
  no_wallet: "wallet.not_found",
  no_price: "chain.rpc_down",
};

// Each balance names an asset the registry knows, once, with some units.
function balancesProblem(
  balances: readonly Amount[],
  chains: ChainRegistry,
): ProtocolErrorCode | undefined {
  const assets = new Set(balances.map((balance) => balance.asset));
  if (assets.size < balances.length || balances.some((balance) => balance.base <= 0n)) {
    return "protocol.bad_args";
  }
  return [...assets].every((asset) => assetInfoOf(chains, asset) !== undefined)
    ? undefined
    : "asset.not_found";
}

interface Scope {
  readonly agent?: Id<"agt">;
  readonly wallet?: Id<"wal">;
}

// The wallets a read names: one wallet (of the agent, when it names one too), an agent's, or every
// agent's; archived wallets are left out.
async function walletsOf(
  options: PortfolioHandlersOptions,
  scope: Scope,
  signal: AbortSignal,
): Promise<Result<readonly WalletRecord[], ProtocolErrorCode>> {
  if (
    scope.agent !== undefined &&
    (await options.agents.get(scope.agent, { signal })) === undefined
  ) {
    return err("agent.not_found");
  }
  const { wallets } = await options.install.read({ signal });
  const named = wallets.filter(
    (wallet) =>
      wallet.archivedAtMs === undefined &&
      (scope.agent === undefined || wallet.agentId === scope.agent) &&
      (scope.wallet === undefined || wallet.id === scope.wallet),
  );
  return scope.wallet !== undefined && named.length === 0 ? err("wallet.not_found") : ok(named);
}

// Every wallet the agent had counts, archived ones too: their trades happened.
async function pnlOf(
  options: PortfolioHandlersOptions,
  args: ArgsOf<"portfolio/pnl">,
  signal: AbortSignal,
): Promise<Result<ResultOf<"portfolio/pnl">, ProtocolErrorCode>> {
  if (args.from > args.to) {
    return err("protocol.bad_args");
  }
  if ((await options.agents.get(args.agent, { signal })) === undefined) {
    return err("agent.not_found");
  }
  const { wallets } = await options.install.read({ signal });
  const owned = wallets.filter((wallet) => wallet.agentId === args.agent).map(({ id }) => id);
  const query = { wallets: owned, fromMs: args.from, toMs: args.to };
  return ok(await pnlViewOf(options, query, { signal }));
}

/**
 * Creates the portfolio handlers. `portfolio/get` answers the live and the paper holdings of the
 * wallets it names, live first, each with its own total (see {@link portfolioViewOf}): a live
 * wallet's balances are read on the chain (see {@link liveHoldingsOf}), a paper wallet's are its
 * paper positions. An unknown agent is `agent.not_found`, a wallet that is not one of its live
 * wallets `wallet.not_found`. `portfolio/pnl` answers the agent's P&L over the range, live and
 * paper apart (see {@link pnlViewOf}), from every wallet the agent had, archived ones too, as
 * their trades happened; a range that ends before it starts is `protocol.bad_args`.
 * `portfolio/resetPaper` starts the agent's paper portfolio again from the balances it names, or
 * from the starting balances, and answers the new paper portfolio with its values now. It never
 * changes the agent's mode or a live position. `asset/search` finds a token's id in the registry
 * and the wallets' positions (see {@link createAssetSearchHandlers}). `market/scan` and
 * `market/chart` read the market reads (see {@link createMarketHandlers}).
 */
export function createPortfolioHandlers(options: PortfolioHandlersOptions): PortfolioHandlers {
  return {
    ...createAssetSearchHandlers(options),
    ...createMarketHandlers({ reads: options.marketReads, chains: options.chains }),
    async "portfolio/get"({ args, signal }) {
      const wallets = await walletsOf(options, args, signal);
      if (!wallets.ok) {
        return wallets;
      }
      const holdings = await Promise.all(
        wallets.value.flatMap((wallet) => [
          liveHoldingsOf(options, wallet, { signal }),
          options.positions
            .value({ walletId: wallet.id, isPaper: true }, { signal })
            .then((valued) => paperHoldingsOf(wallet.id, valued)),
        ]),
      );
      return ok(portfolioViewOf(holdings, options.chains));
    },
    "portfolio/pnl": async ({ args, signal }) => pnlOf(options, args, signal),
    async "portfolio/resetPaper"({ args, signal }) {
      const agent = await activeAgent(options.agents, args.agent, { signal });
      if (!agent.ok) {
        return agent;
      }
      const problem = balancesProblem(args.balances ?? [], options.chains);
      if (problem !== undefined) {
        return err(problem);
      }
      const reset = await options.portfolio.reset(args, { signal });
      if (!reset.ok) {
        return err(resetErrors[reset.error]);
      }
      const valued = await Promise.all(
        reset.value.map(async (walletId) =>
          paperHoldingsOf(
            walletId,
            await options.positions.value({ walletId, isPaper: true }, { signal }),
          ),
        ),
      );
      return ok(portfolioViewOf(valued, options.chains));
    },
  };
}
