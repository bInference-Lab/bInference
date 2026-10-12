import type { ChainRegistry } from "@binference/chain";
import { BinferenceError, type Clock, err, ok } from "@binference/core";
import type { AgentMode, LiveFactsView, PortfolioView } from "@binference/protocol";
import { knownAssetInfos } from "../money-path/asset-infos.js";
import { recentOutflowsOf } from "../money-path/recent-outflows.js";
import { orderViewOf } from "../orders/order-view-of.js";
import type { OrderStore } from "../orders/ports.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { EngineCall, EngineHandler } from "./engine-call.js";

/** The handler of `facts/get` (protocol spec, section 7.2). */
export interface LiveFactsHandlers {
  readonly "facts/get": EngineHandler<"facts/get">;
}

/** What the live facts are read from. */
export interface LiveFactsParts {
  readonly agents: AgentStore;
  readonly orders: Pick<OrderStore, "list">;
  readonly intents: Pick<IntentStore, "confirmedSince" | "storedAssets">;
  /** `portfolio/get`, which values every balance of the agent's wallets. */
  readonly portfolio: EngineHandler<"portfolio/get">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  /** `owner.timezone` now. */
  readonly ownerTimeZone: () => string;
}

// The most orders the facts list: an agent with more reads the rest with `order/list`.
const maxOrders = 50;

// The portfolio as `portfolio/get` answers it; none when a balance could not be read now, as a
// chain no endpoint answers for.
async function portfolioOf(
  parts: LiveFactsParts,
  call: EngineCall<"facts/get">,
): Promise<PortfolioView | undefined> {
  try {
    const read = await parts.portfolio({ ...call, args: { agent: call.args.agent } });
    return read.ok ? read.value : undefined;
  } catch (error) {
    call.signal.throwIfAborted();
    if (error instanceof BinferenceError) {
      return undefined;
    }
    throw error;
  }
}

// The balances of the agent's mode, and their total; none when a balance could not be read now.
async function balancesOf(
  parts: LiveFactsParts,
  call: EngineCall<"facts/get"> & { readonly mode: AgentMode },
): Promise<Pick<LiveFactsView, "balances" | "totalUsdMicros"> & Pick<PortfolioView, "assets">> {
  const read = await portfolioOf(parts, call);
  if (read === undefined) {
    return { assets: {} };
  }
  const isPaper = call.mode === "paper";
  const balances = read.balances.filter((balance) => balance.paper === isPaper);
  const total = isPaper ? (read.paperTotalUsdMicros ?? 0n) : read.totalUsdMicros;
  return { balances, totalUsdMicros: total, assets: read.assets };
}

/**
 * Creates the live facts handler: `facts/get` answers what the agent stands on now, in one read
 * for the runtime to put after each model call's history (runtime spec, section 7.1): its mode,
 * whether it is frozen, its approval mode and send level, the balances of its mode valued in
 * dollars, its active and paused orders, and its outflows of the last 24 hours against the caps in
 * effect. A balance that cannot be read now leaves the balances out, never the rest.
 */
export function createLiveFactsHandlers(parts: LiveFactsParts): LiveFactsHandlers {
  return {
    async "facts/get"(call) {
      const { agent } = call.args;
      const { signal } = call;
      const settings = await parts.agents.get(agent, { signal });
      if (settings === undefined) {
        return err("agent.not_found");
      }
      const nowMs = parts.clock.now();
      const isPaper = settings.agent.mode === "paper";
      const query = { states: ["active", "paused"] as const, agentId: agent, limit: maxOrders };
      const [held, orders, outflows] = await Promise.all([
        balancesOf(parts, { ...call, mode: settings.agent.mode }),
        parts.orders.list(query, { signal }),
        recentOutflowsOf(parts.intents, { agentId: agent, isPaper, nowMs }, { signal }),
      ]);
      const { assets, ...balances } = held;
      const tokens = orders.map((order) => order.request.token);
      const { limits } = settings;
      return ok({
        agent,
        at: nowMs,
        timeZone: parts.ownerTimeZone(),
        mode: settings.agent.mode,
        frozen: settings.agent.frozenAtMs !== undefined,
        approvalMode: settings.approvalMode.mode,
        sendLevel: settings.sendLevel.level,
        ...balances,
        orders: orders.map((order) => orderViewOf(order)),
        spentTodayUsdMicros: outflows.reduce((sum, outflow) => sum + outflow.valueUsdMicros, 0n),
        perTradeUsdMicros: limits.perTradeUsdMicros,
        rollingDayUsdMicros: limits.rollingDayUsdMicros,
        assets: { ...assets, ...(await knownAssetInfos(parts, tokens, { signal })) },
      });
    },
  };
}
