import { type AssetRef, assetRefParts, type ChainRef } from "@binference/chain";
import type { OrderRecord, OrderStore } from "@binference/engine/orders";
import type { ChainWatch } from "./chain-watch.js";

/** The tokens the price watchers read for the active auto orders, kept in step with the store. */
export interface WatchedOrders {
  /**
   * Reads the active orders whose trigger is a price (limit, take-profit, stop-loss and trailing)
   * and watches each of their tokens once, however many orders name it;
   * a token no active order names any more is released. A token of a chain with no watcher is not
   * watched. Rejects when the store cannot answer, and with the signal's reason once it aborts.
   */
  sync(options: { readonly signal: AbortSignal }): Promise<void>;
  /** How many active orders with a price trigger the last sync read. */
  activeOrders(): number;
  /** Releases every watch. */
  releaseAll(): void;
}

const pageSize = 1_000;
// The kinds whose trigger is a price; a DCA order waits for its time, a copy order for its leader.
const priceKinds: ReadonlySet<OrderRecord["kind"]> = new Set([
  "limit",
  "takeProfit",
  "stopLoss",
  "trailing",
]);

async function activeOrders(
  orders: Pick<OrderStore, "list">,
  signal: AbortSignal,
  after?: OrderRecord,
): Promise<readonly OrderRecord[]> {
  const page = await orders.list(
    {
      states: ["active"],
      limit: pageSize,
      ...(after === undefined ? {} : { after: { createdAtMs: after.createdAtMs, id: after.id } }),
    },
    { signal },
  );
  const last = page.at(-1);
  return page.length < pageSize || last === undefined
    ? page
    : [...page, ...(await activeOrders(orders, signal, last))];
}

/** Creates the {@link WatchedOrders} over the order store and each chain's watcher. */
export function createWatchedOrders(options: {
  readonly orders: Pick<OrderStore, "list">;
  readonly watches: ReadonlyMap<ChainRef, ChainWatch>;
}): WatchedOrders {
  const releases = new Map<AssetRef, () => void>();
  let count = 0;
  return {
    async sync({ signal }) {
      const read = (await activeOrders(options.orders, signal)).filter(({ kind }) =>
        priceKinds.has(kind),
      );
      count = read.length;
      const tokens = new Set(read.map(({ request }) => request.token));
      for (const [token, release] of releases) {
        if (!tokens.has(token)) {
          release();
          releases.delete(token);
        }
      }
      for (const token of tokens) {
        const watch = options.watches.get(assetRefParts(token).chain);
        if (watch !== undefined && !releases.has(token)) {
          releases.set(token, watch.watch(token));
        }
      }
    },
    activeOrders: () => count,
    releaseAll() {
      for (const release of releases.values()) {
        release();
      }
      releases.clear();
    },
  };
}
