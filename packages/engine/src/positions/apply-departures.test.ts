import { assetRefSchema, type TxHash } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { applyDepartures } from "./apply-departures.js";
import type { DepartureDraft } from "./departure-record.js";
import type { PositionRecord } from "./position-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const walletId = fixtureId("wal", 1);
const otherWallet = fixtureId("wal", 2);
const txHash = `0x${"ab".repeat(32)}` as TxHash;

const tokenSend: DepartureDraft = {
  walletId,
  atMs: 5_000,
  sent: { asset: token, base: 30n },
  gas: { asset: coin, base: 10n },
  txHash,
};

function held(fields: Partial<PositionRecord>): PositionRecord {
  return {
    walletId,
    asset: token,
    isPaper: false,
    quantityBase: 120n,
    costUsdMicros: 1_000n,
    realizedUsdMicros: -30n,
    changedAtMs: 1_000,
    version: 4,
    ...fields,
  };
}

function stateOf({ version: _version, ...state }: PositionRecord): Omit<PositionRecord, "version"> {
  return state;
}

describe("applyDepartures", () => {
  it("takes the units sent and the gas out of their positions at average cost, realizing nothing", () => {
    const positions = [held({}), held({ asset: coin, quantityBase: 40n, costUsdMicros: 80n })];
    expect(applyDepartures(positions, [tokenSend])).toStrictEqual([
      {
        // 30 of 120 units take a quarter of 1,000.
        position: {
          ...stateOf(held({ quantityBase: 90n, costUsdMicros: 750n })),
          changedAtMs: 5_000,
        },
        readVersion: 4,
      },
      {
        position: {
          ...stateOf(held({ asset: coin, quantityBase: 30n, costUsdMicros: 60n })),
          changedAtMs: 5_000,
        },
        readVersion: 4,
      },
    ]);
  });

  it("adds up departures that leave one position, and keeps each wallet apart", () => {
    const coinSend = { ...tokenSend, sent: { asset: coin, base: 20n }, atMs: 6_000 };
    const elsewhere = { ...coinSend, walletId: otherWallet };
    const positions = [
      held({ asset: coin, quantityBase: 40n, costUsdMicros: 80n }),
      held({ walletId: otherWallet, asset: coin, quantityBase: 100n, costUsdMicros: 100n }),
    ];
    const writes = applyDepartures(positions, [tokenSend, coinSend, elsewhere]);
    expect(writes.map(({ position }) => position)).toStrictEqual([
      // 10 gas, then 20 sent and 10 gas: all 40 units and their cost leave.
      {
        ...stateOf(held({ asset: coin, quantityBase: 0n, costUsdMicros: 0n })),
        changedAtMs: 6_000,
      },
      {
        ...stateOf(
          held({ walletId: otherWallet, asset: coin, quantityBase: 70n, costUsdMicros: 70n }),
        ),
        changedAtMs: 6_000,
      },
    ]);
  });

  it("sends units no position holds with no cost, and writes no row for them", () => {
    expect(applyDepartures([], [tokenSend])).toStrictEqual([]);
    const short = [held({ quantityBase: 10n, costUsdMicros: 100n })];
    expect(applyDepartures(short, [tokenSend]).map(({ position }) => position)).toStrictEqual([
      { ...stateOf(held({ quantityBase: 0n, costUsdMicros: 0n })), changedAtMs: 5_000 },
    ]);
  });

  it("touches only live positions, and keeps a later time of the position", () => {
    const paper = held({ isPaper: true });
    const later = held({ changedAtMs: 9_000 });
    expect(applyDepartures([paper], [tokenSend])).toStrictEqual([]);
    const [write] = applyDepartures([later], [tokenSend]);
    expect(write?.position.changedAtMs).toBe(9_000);
  });

  it("refuses a departure of no units", () => {
    const empty = { ...tokenSend, sent: { asset: token, base: 0n } };
    expect(() => applyDepartures([held({})], [empty])).toThrow(
      expect.objectContaining({ code: "positions.bad_departure" }),
    );
  });
});
