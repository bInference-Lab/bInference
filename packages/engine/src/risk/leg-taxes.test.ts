import { accountRefSchema, type AssetTransfer, assetRefSchema } from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { buyTaxBps, lostBps, netIn } from "./leg-taxes.js";

const account = (address: string) => accountRefSchema.parse(`fake:1:${address}`);
const coin = assetRefSchema.parse("fake:1/slip44:1");
const wrapped = assetRefSchema.parse("fake:1/token:0x000000aa");
const wrapper = account("0x000000aa");
const tokenAsset = assetRefSchema.parse("fake:1/token:0x0000000f");
const trader = account("0x00000001");
const router = account("0x0000000b");
const pool = account("0x000000b1");
const secondPool = account("0x000000b2");
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

describe("leg taxes", () => {
  it("rounds a lost share up, and reads nothing lost or nothing sent as no tax", () => {
    expect(lostBps(3n, 2n)).toBe(3_334);
    expect(lostBps(1_000n, 1_000n)).toBe(0);
    expect(lostBps(1_000n, 1_200n)).toBe(0);
    expect(lostBps(0n, 0n)).toBe(0);
    expect(lostBps(1_000n, 0n)).toBe(10_000);
    expect(lostBps(1_000n, -5n)).toBe(10_000);
  });

  it("adds what reaches an account and takes off what leaves it, in canonical form", () => {
    const transfers = [
      move([router, account("0x0000000F")], tokenAsset, 10n),
      move([contract, pool], tokenAsset, 4n),
      move([router, contract], coin, 99n),
    ];
    expect(netIn(transfers, contract, token)).toBe(6n);
  });

  it("reads a buy tax as the share of what the pool paid out that never reached the buyer", () => {
    const transfers = [
      move([trader, router], coin, 100n),
      move([router, wrapper], coin, 100n),
      move([router, pool], wrapped, 100n),
      move([pool, trader], tokenAsset, 970n),
      move([pool, feeWallet], tokenAsset, 30n),
    ];
    expect(buyTaxBps(transfers, trader, token)).toBe(300);
  });

  it("counts a tax taken at each hop of a route, and a route split over two pools", () => {
    const transfers = [
      move([trader, router], coin, 100n),
      move([router, pool], coin, 60n),
      move([router, secondPool], coin, 40n),
      move([pool, router], tokenAsset, 570n),
      move([pool, feeWallet], tokenAsset, 30n),
      move([secondPool, router], tokenAsset, 400n),
      move([router, trader], tokenAsset, 900n),
      move([router, feeWallet], tokenAsset, 70n),
    ];
    expect(buyTaxBps(transfers, trader, token)).toBe(1_000);
  });

  it("reads no buy tax from a pool that pays out what the buyer receives", () => {
    const transfers = [move([trader, pool], coin, 100n), move([pool, trader], tokenAsset, 1_000n)];
    expect(buyTaxBps(transfers, trader, token)).toBe(0);
  });
});
