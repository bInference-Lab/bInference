import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arrivalRecordSchema, arrivalWriteSchema } from "./arrival-record.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
// Above 2^64, so a value that went through a 64-bit integer or a float comes back changed.
const huge = "18446744073709551617";

// The shapes as they cross the store worker boundary: amounts and dollars as decimal strings.
const arrivalWire = {
  walletId: `wal_${uuid}`,
  isPaper: false,
  atMs: 1_000,
  received: { asset: "fake:1/slip44:1", base: huge },
  txHash: `0x${"ab".repeat(32)}`,
  valueUsdMicros: huge,
};
const { valueUsdMicros: _value, txHash: _txHash, ...unvaluedWire } = arrivalWire;
const positionWire = {
  walletId: `wal_${uuid}`,
  asset: "fake:1/slip44:1",
  isPaper: false,
  quantityBase: huge,
  costUsdMicros: huge,
  realizedUsdMicros: "0",
  changedAtMs: 1_000,
};

describe("arrival records", () => {
  it("round-trips an arrival and its write through the wire form exactly", () => {
    const write = { arrival: arrivalWire, positions: [{ position: positionWire }] };
    const decoded = arrivalWriteSchema.parse(write);
    expect(decoded.arrival.received.base).toBe(18_446_744_073_709_551_617n);
    expect(decoded.arrival.valueUsdMicros).toBe(18_446_744_073_709_551_617n);
    expect(z.encode(arrivalWriteSchema, decoded)).toStrictEqual(write);
    const record = arrivalRecordSchema.parse({ ...arrivalWire, id: 3 });
    expect(z.encode(arrivalRecordSchema, record)).toStrictEqual({ ...arrivalWire, id: 3 });
  });

  it("keeps an arrival with no price and no transaction without those keys", () => {
    const record = arrivalRecordSchema.parse({ ...unvaluedWire, isPaper: true, id: 1 });
    expect(Object.keys(record).toSorted()).toStrictEqual([
      "atMs",
      "id",
      "isPaper",
      "received",
      "walletId",
    ]);
  });

  it("refuses a negative value, a bad hash, a null value and unknown keys", () => {
    const parsed = [
      arrivalRecordSchema.safeParse({ ...arrivalWire, valueUsdMicros: "-1", id: 1 }).success,
      arrivalRecordSchema.safeParse({ ...arrivalWire, valueUsdMicros: null, id: 1 }).success,
      arrivalRecordSchema.safeParse({ ...arrivalWire, txHash: "not a hash", id: 1 }).success,
      arrivalRecordSchema.safeParse({ ...arrivalWire, id: 0 }).success,
      arrivalWriteSchema.safeParse({ arrival: arrivalWire, positions: [], extra: true }).success,
    ];
    expect(parsed).toStrictEqual(parsed.map(() => false));
  });
});
