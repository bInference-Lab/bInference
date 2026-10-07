import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { ArrivalDraft } from "./arrival-record.js";
import { paperResetOf } from "./paper-reset-of.js";
import type { PositionRecord } from "./position-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const walletId = fixtureId("wal", 1);

const held = (asset: typeof coin, version: number): PositionRecord => ({
  walletId,
  asset,
  isPaper: true,
  quantityBase: 40n,
  costUsdMicros: 30n,
  realizedUsdMicros: -7n,
  changedAtMs: 500,
  version,
});

const arrival = (asset: typeof coin, base: bigint): ArrivalDraft => ({
  walletId,
  isPaper: true,
  atMs: 1_000,
  received: { asset, base },
  valueUsdMicros: base * 2n,
});

describe("a wallet's paper reset", () => {
  it("empties each held position from the version read, and opens the balances", () => {
    const reset = paperResetOf({
      walletId,
      atMs: 1_000,
      held: [held(coin, 3), held(token, 1)],
      arrivals: [arrival(coin, 5n)],
    });
    const state = { walletId, isPaper: true, changedAtMs: 1_000 };
    expect(reset).toStrictEqual({
      walletId,
      arrivals: [arrival(coin, 5n)],
      positions: [
        {
          position: {
            ...state,
            asset: token,
            quantityBase: 0n,
            costUsdMicros: 0n,
            realizedUsdMicros: 0n,
          },
          readVersion: 1,
        },
        {
          position: {
            ...state,
            asset: coin,
            quantityBase: 5n,
            costUsdMicros: 10n,
            realizedUsdMicros: 0n,
          },
          readVersion: 3,
        },
      ],
    });
  });

  it("opens a new position for a balance the wallet never held", () => {
    const reset = paperResetOf({ walletId, atMs: 1_000, held: [], arrivals: [arrival(token, 4n)] });
    expect(reset.positions).toStrictEqual([
      {
        position: {
          walletId,
          asset: token,
          isPaper: true,
          quantityBase: 4n,
          costUsdMicros: 8n,
          realizedUsdMicros: 0n,
          changedAtMs: 1_000,
        },
      },
    ]);
  });

  it("refuses two balances of one asset", () => {
    const arrivals = [arrival(coin, 1n), arrival(coin, 2n)];
    expect(() => paperResetOf({ walletId, atMs: 1_000, held: [], arrivals })).toThrow(
      expect.objectContaining({ code: "positions.bad_reset" }),
    );
  });
});
