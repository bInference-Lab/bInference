import { assetRefSchema, type AssetRef } from "@binference/chain";
import type { OrderQuery, OrderRecord } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import type { ChainWatch } from "./chain-watch.js";
import { createWatchedOrders } from "./watched-orders.js";

const signal = new AbortController().signal;
const tokenOf = (byte: string, chain = "eip155:56"): AssetRef =>
  assetRefSchema.parse(`${chain}/erc20:0x00000000000000000000000000000000000000${byte}`);

let ids = 0;
function order(kind: OrderRecord["kind"], token: AssetRef): OrderRecord {
  ids += 1;
  return {
    id: `ord_${String(ids).padStart(4, "0")}`,
    kind,
    createdAtMs: ids,
    request: { kind, token },
  } as unknown as OrderRecord;
}

function storeOf(orders: { current: readonly OrderRecord[] }) {
  const queries: OrderQuery[] = [];
  return {
    queries,
    store: {
      async list(query: OrderQuery) {
        queries.push(query);
        const after = query.after;
        const page = orders.current
          .filter((item) => after === undefined || item.createdAtMs > after.createdAtMs)
          .slice(0, query.limit);
        return await Promise.resolve(page);
      },
    },
  };
}

function watchOf() {
  const watched = new Map<AssetRef, number>();
  const watch = {
    watch(token: AssetRef) {
      watched.set(token, (watched.get(token) ?? 0) + 1);
      return () => watched.set(token, (watched.get(token) ?? 1) - 1);
    },
  } as unknown as ChainWatch;
  return { watch, watched };
}

describe("the watched orders", () => {
  it("watches each token of an active price order once, and releases a token none names", async () => {
    const orders = {
      current: [
        order("stopLoss", tokenOf("01")),
        order("takeProfit", tokenOf("01")),
        order("trailing", tokenOf("02")),
        order("dca", tokenOf("03")),
        order("copy", tokenOf("04")),
        order("limit", tokenOf("05", "eip155:1")),
      ],
    };
    const { store, queries } = storeOf(orders);
    const bsc = watchOf();
    const watched = createWatchedOrders({
      orders: store,
      watches: new Map([["eip155:56" as never, bsc.watch]]),
    });
    await watched.sync({ signal });
    expect(bsc.watched).toStrictEqual(
      new Map([
        [tokenOf("01"), 1],
        [tokenOf("02"), 1],
      ]),
    );
    expect(watched.activeOrders()).toBe(4);
    expect(queries[0]).toStrictEqual({ states: ["active"], limit: 1_000 });
    orders.current = orders.current.slice(2, 3);
    await watched.sync({ signal });
    expect(bsc.watched.get(tokenOf("01"))).toBe(0);
    expect(bsc.watched.get(tokenOf("02"))).toBe(1);
    watched.releaseAll();
    expect(bsc.watched.get(tokenOf("02"))).toBe(0);
  });

  it("reads every page of active orders", async () => {
    const orders = { current: Array.from({ length: 1_001 }, () => order("limit", tokenOf("07"))) };
    const { store, queries } = storeOf(orders);
    const watched = createWatchedOrders({ orders: store, watches: new Map() });
    await watched.sync({ signal });
    expect(watched.activeOrders()).toBe(1_001);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.after?.createdAtMs).toBe(orders.current[999]?.createdAtMs);
  });
});
