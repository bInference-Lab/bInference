import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { applyArrival } from "./apply-arrival.js";
import type { ArrivalDraft } from "./arrival-record.js";
import type { PositionRecord } from "./position-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const walletId = fixtureId("wal", 1);

const deposit: ArrivalDraft = {
  walletId,
  isPaper: false,
  atMs: 5_000,
  received: { asset: coin, base: 100n },
  valueUsdMicros: 900n,
};

function held(fields: Partial<PositionRecord>): PositionRecord {
  return {
    walletId,
    asset: coin,
    isPaper: false,
    quantityBase: 200n,
    costUsdMicros: 1_600n,
    realizedUsdMicros: -30n,
    changedAtMs: 1_000,
    version: 4,
    ...fields,
  };
}

const { valueUsdMicros: _value, ...unpriced } = deposit;

describe("applyArrival", () => {
  it("opens a position at the value of the units when they arrived", () => {
    expect(applyArrival([], deposit)).toStrictEqual([
      {
        position: {
          walletId,
          asset: coin,
          isPaper: false,
          quantityBase: 100n,
          costUsdMicros: 900n,
          realizedUsdMicros: 0n,
          changedAtMs: 5_000,
        },
      },
    ]);
  });

  it("adds to a held position at average cost from the version it read, realizing nothing", () => {
    expect(applyArrival([held({})], deposit)).toStrictEqual([
      {
        position: {
          walletId,
          asset: coin,
          isPaper: false,
          quantityBase: 300n,
          costUsdMicros: 2_500n,
          realizedUsdMicros: -30n,
          changedAtMs: 5_000,
        },
        readVersion: 4,
      },
    ]);
  });

  it("keeps the later time of the position and the arrival", () => {
    const [write] = applyArrival([held({ changedAtMs: 9_000 })], deposit);
    expect(write?.position.changedAtMs).toBe(9_000);
  });

  it("opens a position only in the wallet and mode the funds arrived in", () => {
    const elsewhere = [
      held({ walletId: fixtureId("wal", 2) }),
      held({ isPaper: true }),
      held({ asset: token }),
    ];
    expect(applyArrival(elsewhere, { ...deposit, isPaper: true })).toStrictEqual([
      {
        position: {
          walletId,
          asset: coin,
          isPaper: true,
          quantityBase: 300n,
          costUsdMicros: 2_500n,
          realizedUsdMicros: -30n,
          changedAtMs: 5_000,
        },
        readVersion: 4,
      },
    ]);
    expect(applyArrival(elsewhere.slice(0, 1), deposit)).toStrictEqual(applyArrival([], deposit));
  });

  it("changes no position for an arrival with no value, so its units count no gain or loss", () => {
    expect(applyArrival([held({})], unpriced)).toStrictEqual([]);
    expect(applyArrival([], unpriced)).toStrictEqual([]);
  });

  it("refuses an arrival of no units", () => {
    expect(() =>
      applyArrival([], { ...deposit, received: { asset: coin, base: 0n }, valueUsdMicros: 0n }),
    ).toThrow(expect.objectContaining({ code: "positions.bad_arrival" }));
    expect(() => applyArrival([], { ...unpriced, received: { asset: coin, base: 0n } })).toThrow(
      expect.objectContaining({ code: "positions.bad_arrival" }),
    );
  });
});
