import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testToken, testWallet } from "../intents/test-intents.js";
import { freezeOrderMoves } from "./freeze-order-moves.js";
import type { OrderQuery, OrderRecord } from "./order-record.js";

const cardId = idSchema("crd").parse("crd_0190f1c2-3a4b-7c5d-8e6f-000000000001");

function activeOrder(n: number): OrderRecord {
  const tag = n.toString(16).padStart(12, "0");
  return {
    id: idSchema("ord").parse(`ord_0190f1c2-3a4b-7c5d-8e6f-${tag}`),
    agentId: testAgent,
    walletId: testWallet,
    kind: "stopLoss",
    state: "active",
    request: {
      kind: "stopLoss",
      agent: testAgent,
      token: testToken,
      side: "sell",
      size: { usdMicros: 1n },
      trigger: { price: 1n },
    },
    fills: 0,
    expiresAtMs: 10_000,
    intentId: idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-${tag}`),
    cardId,
    isPaper: false,
    hasOutsideContent: false,
    createdAtMs: n,
    changedAtMs: n,
    version: 1,
  };
}

// An order store's list over the held orders: oldest first, after the cursor, at most the limit.
function listOf(
  held: readonly OrderRecord[],
  seen: { readonly push: (query: OrderQuery) => void },
) {
  return async (query: OrderQuery): Promise<readonly OrderRecord[]> => {
    seen.push(query);
    const from = query.after?.createdAtMs ?? 0;
    return Promise.resolve(held.filter((order) => order.createdAtMs > from).slice(0, query.limit));
  };
}

describe("the order moves of a freeze", () => {
  it("pauses every active order of the agent, page after page", async () => {
    const held = Array.from({ length: 1_001 }, (_, n) => activeOrder(n + 1));
    const queries: OrderQuery[] = [];
    const orders = { list: listOf(held, queries) };

    const moves = await freezeOrderMoves(orders, [testAgent], {
      nowMs: 5,
      signal: new AbortController().signal,
    });

    expect(moves).toHaveLength(1_001);
    expect(new Set(moves.map(({ state }) => state))).toStrictEqual(new Set(["paused"]));
    expect(queries.map(({ after }) => after?.createdAtMs)).toStrictEqual([undefined, 1_000]);
  });
});
