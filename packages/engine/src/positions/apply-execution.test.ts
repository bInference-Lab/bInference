import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { applyExecution } from "./apply-execution.js";
import type { ExecutionDraft } from "./execution-record.js";
import type { PositionRecord } from "./position-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const other = assetRefSchema.parse("fake:1/token:b");
const walletId = fixtureId("wal", 1);

function execution(fields: Partial<ExecutionDraft>): ExecutionDraft {
  return {
    intentId: fixtureId("int", 1),
    walletId,
    isPaper: false,
    atMs: 5_000,
    sold: { asset: coin, base: 100n },
    feeBase: 2n,
    bought: { asset: token, base: 40n },
    gas: { asset: coin, base: 10n },
    valueUsdMicros: 1_000n,
    feeUsdMicros: 20n,
    gasUsdMicros: 100n,
    ...fields,
  };
}

function held(fields: Partial<PositionRecord>): PositionRecord {
  return {
    walletId,
    asset: coin,
    isPaper: false,
    quantityBase: 200n,
    costUsdMicros: 1_600n,
    realizedUsdMicros: 0n,
    changedAtMs: 1_000,
    version: 4,
    ...fields,
  };
}

describe("applyExecution", () => {
  it("takes the sold units and fee, then the gas, from a held coin and buys at the full cost", () => {
    // Coin: 201 held at 1,600. Sold 102 with the fee for 1,020: cost out 1,600 x 102 / 201 =
    // 811.94, rounded up to 812, gain 208. Gas 10 of the 99 left for 100: cost out 788 x 10 / 99
    // = 79.6, rounded up to 80, gain 20. Token: 40 at 1,000 + 20 + 100.
    expect(applyExecution([held({ quantityBase: 201n })], execution({}))).toStrictEqual([
      {
        position: {
          walletId,
          asset: coin,
          isPaper: false,
          quantityBase: 89n,
          costUsdMicros: 708n,
          realizedUsdMicros: 228n,
          changedAtMs: 5_000,
        },
        readVersion: 4,
      },
      {
        position: {
          walletId,
          asset: token,
          isPaper: false,
          quantityBase: 40n,
          costUsdMicros: 1_120n,
          realizedUsdMicros: 0n,
          changedAtMs: 5_000,
        },
      },
    ]);
  });

  it("pays the gas from the coin held before a sale's coin arrives", () => {
    const sale = execution({
      sold: { asset: token, base: 40n },
      bought: { asset: coin, base: 150n },
    });
    // Gas 10 of 200 for 100: cost out 80, gain 20. Then 150 arrive for 1,000 + 20 + 100.
    // Token: nothing held, so it leaves with no gain or loss and leaves no row.
    expect(applyExecution([held({})], sale)).toStrictEqual([
      {
        position: {
          walletId,
          asset: coin,
          isPaper: false,
          quantityBase: 340n,
          costUsdMicros: 2_640n,
          realizedUsdMicros: 20n,
          changedAtMs: 5_000,
        },
        readVersion: 4,
      },
    ]);
  });

  it("writes a held position that ends empty, and a new one bought for nothing", () => {
    const closing = execution({
      sold: { asset: coin, base: 198n },
      gas: { asset: coin, base: 0n },
      valueUsdMicros: 1_580n,
      gasUsdMicros: 0n,
      bought: { asset: token, base: 7n },
    });
    // 200 held at 1,600 leave for 1,580 + 20: no gain, nothing left. Token: 7 for 1,600.
    expect(
      applyExecution([held({})], closing).map(({ position, readVersion }) => [
        position.asset,
        position.quantityBase,
        position.costUsdMicros,
        position.realizedUsdMicros,
        readVersion,
      ]),
    ).toStrictEqual([
      [coin, 0n, 0n, 0n, 4],
      [token, 7n, 1_600n, 0n, undefined],
    ]);
    const free = execution({
      feeBase: 0n,
      feeUsdMicros: 0n,
      gas: { asset: coin, base: 0n },
      gasUsdMicros: 0n,
      valueUsdMicros: 0n,
    });
    expect(applyExecution([], free).map(({ position }) => position.quantityBase)).toStrictEqual([
      40n,
    ]);
  });

  it("writes the loss of a buy that delivered nothing as a new position", () => {
    const nothing = execution({ bought: { asset: token, base: 0n } });
    expect(applyExecution([], nothing).map(({ position }) => position)).toStrictEqual([
      {
        walletId,
        asset: token,
        isPaper: false,
        quantityBase: 0n,
        costUsdMicros: 0n,
        realizedUsdMicros: -1_120n,
        changedAtMs: 5_000,
      },
    ]);
  });

  it("writes no row for a coin held only from outside its executions", () => {
    const writes = applyExecution([], execution({}));
    expect(writes.map((write) => write.position.asset)).toStrictEqual([token]);
  });

  it("leaves a held coin alone when no gas was paid", () => {
    const paperFill = execution({
      sold: { asset: token, base: 1n },
      feeBase: 0n,
      feeUsdMicros: 0n,
      bought: { asset: other, base: 1n },
      gas: { asset: coin, base: 0n },
      gasUsdMicros: 0n,
    });
    const writes = applyExecution([held({})], paperFill);
    expect(writes.map((write) => write.position.asset)).toStrictEqual([other]);
  });

  it("reads only the positions of the execution's wallet and mode", () => {
    const others = [
      held({ walletId: fixtureId("wal", 2), version: 1 }),
      held({ isPaper: true, version: 2 }),
    ];
    const writes = applyExecution(others, execution({}));
    expect(writes.map((write) => [write.position.asset, write.readVersion])).toStrictEqual([
      [token, undefined],
    ]);
  });

  it("keeps the later change time when an older execution lands late", () => {
    const [coinWrite] = applyExecution([held({ changedAtMs: 9_000 })], execution({}));
    expect(coinWrite?.position.changedAtMs).toBe(9_000);
  });

  it("refuses an execution that sells nothing, buys what it sells, or values unpaid costs", () => {
    expect(() => applyExecution([], execution({ sold: { asset: coin, base: 0n } }))).toThrow(
      expect.objectContaining({ code: "positions.bad_execution" }),
    );
    expect(() => applyExecution([], execution({ bought: { asset: coin, base: 1n } }))).toThrow(
      expect.objectContaining({ code: "positions.bad_execution" }),
    );
    expect(() => applyExecution([], execution({ feeBase: 0n }))).toThrow(
      expect.objectContaining({ code: "positions.bad_execution" }),
    );
    expect(() => applyExecution([], execution({ gas: { asset: coin, base: 0n } }))).toThrow(
      expect.objectContaining({ code: "positions.bad_execution" }),
    );
  });
});
