import { accountRefSchema, type AssetTransfer, assetRefSchema } from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { sellTaxBps } from "./sale-tax.js";

const account = (address: string) => accountRefSchema.parse(`fake:1:${address}`);
const coin = assetRefSchema.parse("fake:1/slip44:1");
const wrapped = assetRefSchema.parse("fake:1/token:0x000000aa");
const wrapper = account("0x000000aa");
const tokenAsset = assetRefSchema.parse("fake:1/token:0x0000000f");
const trader = account("0x00000001");
const router = account("0x0000000b");
const pool = account("0x000000b1");
const feeWallet = account("0x000000fe");
const contract = account("0x0000000F");
const token = { asset: tokenAsset, contract, family: createFakeFamily() };

// One transfer: `base` of `asset` from one account to another.
function move(
  [from, to]: readonly [typeof trader, typeof trader],
  asset: typeof coin,
  base: bigint,
): AssetTransfer {
  return { from, to, amount: { asset, base } };
}

describe("sale tax", () => {
  it("reads a sell tax as the share of the sale no pool took in", () => {
    const transfers = [
      move([trader, pool], tokenAsset, 600n),
      move([trader, feeWallet], tokenAsset, 400n),
      move([pool, trader], coin, 50n),
    ];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(4_000);
  });

  it("reads what the seller sent to an account its family cannot read as tax", () => {
    const unreadable = account("nowhere");
    const transfers = [
      move([trader, pool], tokenAsset, 600n),
      move([trader, unreadable], tokenAsset, 400n),
      move([pool, trader], coin, 50n),
    ];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(4_000);
  });

  it("leaves out what the token's own contract swaps into the pool during a sale", () => {
    const transfers = [
      move([trader, contract], tokenAsset, 300n),
      move([contract, pool], tokenAsset, 5_000n),
      move([pool, contract], coin, 20n),
      move([trader, router], tokenAsset, 700n),
      move([router, pool], tokenAsset, 700n),
      move([pool, router], coin, 60n),
      move([router, trader], coin, 60n),
    ];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(3_000);
  });

  it("reads a reflection token's sale, which logs only what reached the pool, by the amount sold", () => {
    const transfers = [move([trader, pool], tokenAsset, 950n), move([pool, trader], coin, 10n)];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(500);
  });

  it("leaves out a tax contract's own sale into the pool, whose proceeds go to its wallets", () => {
    const handler = account("0x000000ea");
    const transfers = [
      move([trader, handler], tokenAsset, 400n),
      move([handler, feeWallet], tokenAsset, 360n),
      move([handler, pool], tokenAsset, 40n),
      move([pool, handler], wrapped, 4n),
      move([handler, account("0x000000f1")], wrapped, 4n),
      move([trader, pool], tokenAsset, 600n),
      move([pool, router], wrapped, 60n),
      move([router, wrapper], wrapped, 60n),
      move([wrapper, router], coin, 60n),
      move([router, trader], coin, 60n),
    ];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(4_000);
  });

  it("counts what a router passes on to the pool, and a tax it pays on that hop", () => {
    const transfers = [
      move([trader, router], tokenAsset, 1_000n),
      move([router, pool], tokenAsset, 900n),
      move([router, feeWallet], tokenAsset, 100n),
      move([pool, trader], coin, 50n),
    ];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(1_000);
  });

  it("counts against the sale a tax a pool on the path pays on its own transfer", () => {
    const transfers = [
      move([trader, router], tokenAsset, 1_000n),
      move([router, pool], tokenAsset, 1_000n),
      move([pool, feeWallet], tokenAsset, 50n),
      move([pool, router], coin, 50n),
      move([router, trader], coin, 50n),
    ];
    expect(sellTaxBps(transfers, trader, { sold: 1_000n, token })).toBe(500);
  });
});
