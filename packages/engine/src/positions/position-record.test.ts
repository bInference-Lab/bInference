import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  executionDraftSchema,
  executionQuerySchema,
  executionRecordSchema,
} from "./execution-record.js";
import {
  executionWriteSchema,
  positionQuerySchema,
  positionRecordSchema,
} from "./position-record.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
// Above 2^64, so a value that went through a 64-bit integer or a float comes back changed.
const huge = "18446744073709551617";

// The shapes as they cross the store worker boundary: amounts and dollars as decimal strings.
const executionWire = {
  intentId: `int_${uuid}`,
  walletId: `wal_${uuid}`,
  isPaper: false,
  atMs: 1_000,
  sold: { asset: "fake:1/slip44:1", base: huge },
  feeBase: "25",
  bought: { asset: "fake:1/token:a", base: "1000" },
  gas: { asset: "fake:1/slip44:1", base: "7" },
  txHash: `0x${"ab".repeat(32)}`,
  valueUsdMicros: "600000000",
  feeUsdMicros: "1500000",
  gasUsdMicros: "300000",
};
const positionWire = {
  walletId: `wal_${uuid}`,
  asset: "fake:1/token:a",
  isPaper: true,
  quantityBase: huge,
  costUsdMicros: "601800000",
  realizedUsdMicros: "-1500000",
  changedAtMs: 1_000,
};

describe("position and execution records", () => {
  it("round-trips every shape through its wire form exactly", () => {
    const write = {
      execution: executionWire,
      positions: [{ position: positionWire, readVersion: 2 }],
    };
    const decoded = executionWriteSchema.parse(write);
    expect(decoded.execution.sold.base).toBe(18_446_744_073_709_551_617n);
    expect(decoded.positions[0]?.position.realizedUsdMicros).toBe(-1_500_000n);
    expect(z.encode(executionWriteSchema, decoded)).toStrictEqual(write);
    const record = executionRecordSchema.parse({ ...executionWire, id: 4 });
    expect(z.encode(executionRecordSchema, record)).toStrictEqual({ ...executionWire, id: 4 });
    const position = positionRecordSchema.parse({ ...positionWire, version: 0 });
    expect(z.encode(positionRecordSchema, position)).toStrictEqual({ ...positionWire, version: 0 });
  });

  it("parses the queries", () => {
    const query = {
      after: 0,
      limit: 100,
      isPaper: false,
      walletId: `wal_${uuid}`,
      fromMs: 1,
      toMs: 2,
    };
    expect(executionQuerySchema.parse(query)).toStrictEqual(query);
    expect(positionQuerySchema.parse({ walletId: `wal_${uuid}`, isPaper: true })).toStrictEqual({
      walletId: `wal_${uuid}`,
      isPaper: true,
    });
  });

  it("refuses negative amounts, a minus zero, unknown keys and an empty page", () => {
    const parsed = [
      executionDraftSchema.safeParse({ ...executionWire, feeBase: "-1" }).success,
      executionDraftSchema.safeParse({ ...executionWire, txHash: "not a hash" }).success,
      executionDraftSchema.safeParse({ ...executionWire, extra: true }).success,
      positionRecordSchema.safeParse({ ...positionWire, quantityBase: "-1", version: 0 }).success,
      positionRecordSchema.safeParse({ ...positionWire, realizedUsdMicros: "-0", version: 0 })
        .success,
      executionQuerySchema.safeParse({ after: 0, limit: 0, isPaper: false }).success,
      positionQuerySchema.safeParse({ walletId: `agt_${uuid}`, isPaper: true }).success,
    ];
    expect(parsed).toStrictEqual(parsed.map(() => false));
  });
});
