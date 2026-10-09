import { describe, expect, it } from "vitest";
import { z } from "zod";
import { departureRecordSchema, departureWriteSchema } from "./departure-record.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
// Above 2^64, so a value that went through a 64-bit integer or a float comes back changed.
const huge = "18446744073709551617";

// The shapes as they cross the store worker boundary: amounts and dollars as decimal strings.
const departureWire = {
  walletId: `wal_${uuid}`,
  atMs: 1_000,
  sent: { asset: "fake:1/token:a", base: huge },
  gas: { asset: "fake:1/slip44:1", base: "21000" },
  txHash: `0x${"ab".repeat(32)}`,
};
const positionWire = {
  walletId: `wal_${uuid}`,
  asset: "fake:1/token:a",
  isPaper: false,
  quantityBase: "0",
  costUsdMicros: "0",
  realizedUsdMicros: "-5",
  changedAtMs: 1_000,
};

describe("departure records", () => {
  it("round-trips a departure and its write through the wire form exactly", () => {
    const write = {
      intentId: `int_${uuid}`,
      departures: [departureWire],
      positions: [{ position: positionWire, readVersion: 2 }],
    };
    const decoded = departureWriteSchema.parse(write);
    expect(decoded.departures[0]?.sent.base).toBe(18_446_744_073_709_551_617n);
    expect(z.encode(departureWriteSchema, decoded)).toStrictEqual(write);
    const stored = { ...departureWire, intentId: `int_${uuid}`, id: 3 };
    expect(z.encode(departureRecordSchema, departureRecordSchema.parse(stored))).toStrictEqual(
      stored,
    );
  });

  it("refuses a write with no departure, a bad hash and unknown keys", () => {
    const write = { intentId: `int_${uuid}`, departures: [departureWire], positions: [] };
    const parsed = [
      departureWriteSchema.safeParse({ ...write, departures: [] }).success,
      departureWriteSchema.safeParse({ ...write, extra: true }).success,
      departureRecordSchema.safeParse({
        ...departureWire,
        txHash: "not a hash",
        intentId: write.intentId,
        id: 1,
      }).success,
      departureRecordSchema.safeParse({ ...departureWire, id: 1 }).success,
    ];
    expect(parsed).toStrictEqual(parsed.map(() => false));
  });
});
