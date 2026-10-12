import type { ChainRef } from "@binference/chain";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CheckFinding } from "./check-finding.js";
import { connectEngine } from "./connect-engine.js";
import type { InstallCheck } from "./install-findings.js";

const check = "rpc.keyed";
// The kinds the price watchers read for; a DCA or copy order waits on no price.
const priceKinds: ReadonlySet<string> = new Set(["limit", "takeProfit", "stopLoss", "trailing"]);
const pageLimit = 200;

// The enabled chains that read only the chain file's public RPCs: config names no RPC of the
// owner's for them, neither over HTTP nor over WebSocket.
function publicOnlyChains(config: BinferenceConfig): readonly ChainRef[] {
  return config.chains.enabled.filter((chain) => {
    const own = config.chains.rpc[chain];
    return (own?.urls ?? []).length === 0 && own?.ws === undefined;
  });
}

// The live auto orders with a price trigger the running engine holds, counted on its first page;
// none when no engine answers.
async function liveOrders(options: InstallCheck): Promise<number | undefined> {
  const connection = await connectEngine(options.host, options.signal);
  if (!connection.ok) {
    return undefined;
  }
  try {
    const page = await connection.client.call(
      "order/list",
      { state: "active", limit: pageLimit },
      { signal: options.signal },
    );
    return page.items.filter((order) => priceKinds.has(order.kind) && order.paper !== true).length;
  } catch {
    return undefined;
  } finally {
    connection.client.close();
  }
}

/**
 * `rpc.keyed` (decision 0193) from the config and the count of live auto orders with a price
 * trigger the running engine holds: a warning while there is one and an enabled chain reads only
 * its public RPCs, which are rate limited and offer no WebSocket, so its price watcher can fall
 * behind; it recommends a paid RPC under `chains.rpc`, with its `ws` URL. Without config, or with
 * no engine to count the orders (`undefined`), the check is skipped.
 */
export function rpcKeyedOf(
  config: BinferenceConfig | undefined,
  liveOrderCount: number | undefined,
): CheckFinding {
  const chains = config === undefined ? [] : publicOnlyChains(config);
  if (config === undefined || liveOrderCount === undefined) {
    return { check, level: "skip" };
  }
  if (chains.length === 0 || liveOrderCount === 0) {
    return { check, level: "ok" };
  }
  return {
    check,
    level: "warn",
    message: { key: "check.rpcKeyed", values: { count: liveOrderCount } },
    details: { chains: [...chains], orders: liveOrderCount },
  };
}

/**
 * `rpc.keyed`: counts the live auto orders with a price trigger on the running engine's first page
 * of active orders, when config leaves a chain on its public RPCs, and judges them with
 * {@link rpcKeyedOf}.
 */
export async function rpcKeyedFinding(
  options: InstallCheck,
  config: BinferenceConfig | undefined,
): Promise<CheckFinding> {
  const needsCount = config !== undefined && publicOnlyChains(config).length > 0;
  return rpcKeyedOf(config, needsCount ? await liveOrders(options) : 0);
}
