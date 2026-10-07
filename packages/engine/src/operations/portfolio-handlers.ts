import type { Amount, ChainRegistry } from "@binference/chain";
import { err, ok } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { PaperPortfolio } from "../paper/paper-portfolio.js";
import type { AgentStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import { activeAgent } from "./active-agent.js";
import type { EngineHandler } from "./engine-call.js";
import { paperPortfolioViewOf } from "./paper-portfolio-view.js";

/** The handler of `portfolio/resetPaper` (protocol spec, section 7.3). */
export interface PortfolioHandlers {
  readonly "portfolio/resetPaper": EngineHandler<"portfolio/resetPaper">;
}

/** What the portfolio handlers read and reset through. */
export interface PortfolioHandlersOptions {
  readonly agents: AgentStore;
  readonly portfolio: PaperPortfolio;
  readonly positions: Positions;
  readonly chains: ChainRegistry;
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

/**
 * Creates the portfolio handlers. `portfolio/resetPaper` starts the agent's paper portfolio again
 * from the balances it names, or from the starting balances, and answers the new paper portfolio
 * with its values now. It never changes the agent's mode or a live position.
 */
export function createPortfolioHandlers(options: PortfolioHandlersOptions): PortfolioHandlers {
  return {
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
          options.positions.value({ walletId, isPaper: true }, { signal }),
        ),
      );
      return ok(paperPortfolioViewOf(valued.flat(), options.chains));
    },
  };
}
