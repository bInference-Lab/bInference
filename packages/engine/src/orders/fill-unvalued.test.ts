import type { ReceiptReader } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { driveUntil, flush } from "../executor/test-executor.js";
import { fillRowsOf } from "./test-fills.js";
import {
  activeOrderOf,
  executorNotices,
  fillOnce,
  limitBuy,
  liveFillsOf,
  startLiveFills,
} from "./test-live-fills.js";
import { storedOrder } from "./test-orders.js";

// Receipts whose transfers no node answers while it is silent, so no trade can be valued.
function silentTransfers() {
  const state = { isSilent: true };
  return {
    speak: () => {
      state.isSilent = false;
    },
    wrap: (network: FakeNetwork): ReceiptReader => ({
      ...network,
      transfers: async (chain, hash, options) =>
        state.isSilent
          ? Promise.reject(new Error("The node did not answer."))
          : network.transfers(chain, hash, options),
    }),
  };
}

describe("a live fill whose trade cannot be valued", () => {
  it("is counted on its order after the settle wait, frees the line, and settles once valued", async () => {
    const silent = silentTransfers();
    const bench = await startLiveFills({
      receipts: silent.wrap,
      limits: { settleAfterBlocks: 3 },
    });
    const order = await activeOrderOf(bench);
    const other = await activeOrderOf(bench, { ...limitBuy, maxFills: 2 });
    await fillOnce(bench, order.id);
    const [fill] = await liveFillsOf(bench);
    const id = fill?.id as Id<"int">;

    await driveUntil(bench, id, { states: ["finalized"] });
    await driveUntil(bench, id, { states: [], blocks: 5 });
    await flush();
    const counted = await storedOrder(bench.test, order.id);
    const next = await fillOnce(bench, other.id);
    silent.speak();
    await driveUntil(bench, id, { states: ["reconciled"], blocks: 30 });
    await flush();

    expect(counted).toMatchObject({ state: "filled", fills: 1 });
    expect(next).toBe("sent");
    expect(executorNotices(bench)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "notice.fillUnvalued" })]),
    );
    const rows = await fillRowsOf(bench.test, order.id);
    expect(rows.map(({ outcome }) => outcome)).toStrictEqual(["filled"]);
    const settled = (await liveFillsOf(bench)).find((record) => record.id === id);
    expect(settled?.state).toBe("reconciled");
  });
});
