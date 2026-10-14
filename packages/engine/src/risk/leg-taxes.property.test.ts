import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buyLegOf, buyTaxBps, lostBps } from "./leg-taxes.js";
import { sellTaxBps } from "./sale-tax.js";

const account = (address: string) => accountRefSchema.parse(`fake:1:${address}`);
const coin = assetRefSchema.parse("fake:1/slip44:1");
const tokenAsset = assetRefSchema.parse("fake:1/token:0x0000000f");
const trader = account("0x00000001");
const pool = account("0x000000b1");
const feeWallet = account("0x000000fe");
const hook = account("0x000000a1");
const token = { asset: tokenAsset, contract: account("0x0000000f"), family: createFakeFamily() };

// A fee the token takes, rounded down as a token's integer math does.
function feeOf(base: bigint, bps: number): bigint {
  return (base * BigInt(bps)) / 10_000n;
}

const amounts = fc.bigInt({ min: 10_000n, max: 10n ** 30n });
const taxes = fc.integer({ min: 0, max: 10_000 });
// An amount sent, and how much of it never arrived.
const sentAndLost = amounts.chain((sent) =>
  fc.tuple(fc.constant(sent), fc.bigInt({ min: 0n, max: sent })),
);

describe("leg taxes, for any amount and tax", () => {
  it("reads a share never below what was lost, and at most one basis point above it", () => {
    fc.assert(
      fc.property(sentAndLost, ([sent, lost]: readonly [bigint, bigint]) => {
        const bps = lostBps(sent, sent - lost);
        expect(BigInt(bps) * sent).toBeGreaterThanOrEqual(lost * 10_000n);
        expect(BigInt(bps) * sent).toBeLessThan(lost * 10_000n + sent);
      }),
    );
  });

  it("reads back a buy tax the token takes, within one basis point", () => {
    fc.assert(
      fc.property(amounts, taxes, (out, tax) => {
        const fee = feeOf(out, tax);
        const transfers = [
          { from: trader, to: pool, amount: { asset: coin, base: 1n } },
          { from: pool, to: trader, amount: { asset: tokenAsset, base: out - fee } },
          { from: pool, to: feeWallet, amount: { asset: tokenAsset, base: fee } },
        ];
        const read = buyTaxBps(transfers, trader, token);
        expect(read).toBeLessThanOrEqual(tax);
        expect(read).toBeGreaterThanOrEqual(tax - 1);
      }),
    );
  });

  it("reads a route's pool hook's take apart from the token's buy tax, each within one basis point", () => {
    // At least 20,000 base units stay after the hook's half at most, so each read is within one.
    const grosses = fc.bigInt({ min: 40_000n, max: 10n ** 30n });
    const hookShares = fc.integer({ min: 0, max: 5_000 });
    fc.assert(
      fc.property(grosses, hookShares, taxes, (gross, hookBps, tax) => {
        const taken = feeOf(gross, hookBps);
        const fee = feeOf(gross - taken, tax);
        const transfers = [
          { from: trader, to: pool, amount: { asset: coin, base: 1n } },
          { from: pool, to: hook, amount: { asset: tokenAsset, base: taken } },
          { from: pool, to: trader, amount: { asset: tokenAsset, base: gross - taken - fee } },
          { from: pool, to: feeWallet, amount: { asset: tokenAsset, base: fee } },
        ];
        const leg = buyLegOf(transfers, trader, { ...token, hooks: [hook] });
        expect(leg.hookFeeBps).toBeLessThanOrEqual(hookBps);
        expect(leg.hookFeeBps).toBeGreaterThanOrEqual(hookBps - 1);
        expect(leg.taxBps).toBeLessThanOrEqual(tax);
        expect(leg.taxBps).toBeGreaterThanOrEqual(tax - 1);
      }),
    );
  });

  it("reads back a sell tax the token takes, within one basis point", () => {
    fc.assert(
      fc.property(amounts, taxes, (sold, tax) => {
        const fee = feeOf(sold, tax);
        const transfers = [
          { from: trader, to: pool, amount: { asset: tokenAsset, base: sold - fee } },
          { from: trader, to: feeWallet, amount: { asset: tokenAsset, base: fee } },
          { from: pool, to: trader, amount: { asset: coin, base: 1n } },
        ];
        const read = sellTaxBps(transfers, trader, { sold, token });
        expect(read).toBeLessThanOrEqual(tax);
        expect(read).toBeGreaterThanOrEqual(tax - 1);
      }),
    );
  });
});
