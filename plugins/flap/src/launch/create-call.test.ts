import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { newTokenArgsOf, newTokenCallData } from "../portal/launch-call.js";
import { createOfArgs, newTokenArgsFor } from "./create-call.js";

const terms = {
  name: "Moon Cat",
  symbol: "MCAT",
  meta: "bafkreibxo4udedy3sxsljj7bmrvs7aodggcj6n4m5xaxb5xtydv3fwruem",
  salt: "0xfa46d944e827c386aa1f9207cbd6e50a331ca1d51228261ac83939d2a0119f0a",
  quoteToken: zeroAddress,
  quoteAmt: 10n ** 17n,
} as const;
const settings = {
  buyTaxBps: 300,
  sellTaxBps: 500,
  taxRecipient: getAddress("0x00000000000000000000000000000000000000aa"),
  burnShareBps: 2_500,
  taxDays: 365,
};

describe("a Flap create call", () => {
  it("writes the settings into a Tax Token V3 launch and reads them back", () => {
    const args = newTokenArgsFor(terms, settings);
    expect(args).toMatchObject({
      buyTaxRate: 300,
      sellTaxRate: 500,
      beneficiary: settings.taxRecipient,
      mktBps: 7_500,
      deflationBps: 2_500,
      taxDuration: 31_536_000n,
      tokenVersion: 6,
      migratorType: 1,
      dividendToken: zeroAddress,
    });
    const decoded = newTokenArgsOf(newTokenCallData(args));
    expect(decoded).toStrictEqual(args);
    expect(createOfArgs(args)).toStrictEqual({
      terms,
      settings,
    });
  });

  it.each([
    ["a commission receiver", { commissionReceiver: settings.taxRecipient }],
    ["a dividend share", { mktBps: 5_000, dividendBps: 2_500 }],
    ["a tax that ends part way through a day", { taxDuration: 31_536_001n }],
    ["a standard token", { tokenVersion: 2 }],
    ["an extension", { extensionID: `0x${"01".repeat(32)}` as const }],
    ["permit data", { permitData: "0x01" as const }],
    ["an anti-farmer wait", { antiFarmerDuration: 1n }],
    ["another migration threshold", { dexThresh: 0 }],
    ["another migrator", { migratorType: 0 }],
    ["another DEX", { dexId: 1 }],
    ["another pool fee tier", { lpFeeTier: 1 }],
    ["a tax below 1%", { buyTaxRate: 50 }],
    ["a tax above 10%", { sellTaxRate: 1_001 }],
    ["no tax on either side", { buyTaxRate: 0, sellTaxRate: 0 }],
    ["a tax of no days", { taxDuration: 0n }],
  ])("is none the venue builds with %s", (_name, change) => {
    expect(createOfArgs({ ...newTokenArgsFor(terms, settings), ...change })).toBeUndefined();
  });
});
