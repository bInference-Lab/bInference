import { accountRefSchema } from "@binference/chain";
import { fakeDraft, txSimulatorContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { createTokenModelSimulator, unknownToken } from "./test-round-trip.js";

const buyer = accountRefSchema.parse("fake:1:0x00000001");
const holder = accountRefSchema.parse("fake:1:0x00000002");
const pool = accountRefSchema.parse("fake:1:0x0000000b");
const buy = fakeDraft(buyer, {
  to: "0x0000000b",
  value: 10n,
  data: `swap,0x00000001,10,${testCoin},0,${unknownToken},1`,
});
const send = fakeDraft(buyer, { to: "0x0000000f", value: 0n, data: "transfer,0x00000002,20" });

describe("token model simulator", () => {
  it.each(
    txSimulatorContract({
      create: () => ({
        simulator: createTokenModelSimulator({ blocksTransfers: false }),
        moving: {
          drafts: [send],
          transfer: { from: buyer, to: holder, amount: { asset: unknownToken, base: 20n } },
        },
        reverting: [send, buy],
        unfunded: { drafts: [buy], balance: { asset: testCoin, base: 10n } },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("buys at two to one from the pool with the coin the run gives the buyer", async () => {
    const simulator = createTokenModelSimulator({});
    const signal = new AbortController().signal;
    const [bought] = await simulator.simulate([buy], {
      signal,
      balances: [{ asset: testCoin, base: 10n }],
    });
    expect(bought?.transfers).toStrictEqual([
      { from: buyer, to: pool, amount: { asset: testCoin, base: 10n } },
      { from: pool, to: buyer, amount: { asset: unknownToken, base: 20n } },
    ]);
  });

  it("takes each leg's tax as the model says, and reverts the legs it blocks", async () => {
    const simulator = createTokenModelSimulator({ transferTaxBps: 1_000, blocksSales: true });
    const signal = new AbortController().signal;
    const [, sent] = await simulator.simulate([buy, send], {
      signal,
      balances: [{ asset: testCoin, base: 10n }],
    });
    expect(sent?.transfers.map((transfer) => transfer.amount.base)).toStrictEqual([18n, 2n]);
    expect(sent?.transfers[0]?.to).toBe(holder);
  });
});
