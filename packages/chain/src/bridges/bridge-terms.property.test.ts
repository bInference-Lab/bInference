import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bridgeQuoteSchema, decodedDepositSchema } from "./bridge-terms.js";

const sent = "fake:1/token:0x000000f1";
const arrives = "fake:2/token:0x000000f3";
const units = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const epochMs = fc.integer({ min: 0, max: 2 ** 52 });
const half = fc.bigInt({ min: 0n, max: 2n ** 255n });

describe("bridge terms on the wire", () => {
  it("decode and encode any ordered quote without a change, and refuse a least above expected", () => {
    fc.assert(
      fc.property(
        half,
        half,
        fc.record({ at: epochMs, life: fc.integer({ min: 1, max: 3_600_000 }) }),
        (low, gap, { at, life }) => {
          const high = low + gap;
          const wire = {
            expectedOut: { asset: arrives, base: high.toString() },
            minOut: { asset: arrives, base: low.toString() },
            fees: [{ kind: "relayer" as const, amount: { asset: sent, base: low.toString() } }],
            etaSeconds: 2,
            quotedAtMs: at,
            expiresAtMs: at + life,
          };
          expect(z.encode(bridgeQuoteSchema, z.decode(bridgeQuoteSchema, wire))).toStrictEqual(
            wire,
          );
          const flipped = { ...wire, minOut: { asset: arrives, base: (high + 1n).toString() } };
          expect(bridgeQuoteSchema.safeParse(flipped).success).toBe(false);
          const expired = { ...wire, expiresAtMs: at };
          expect(bridgeQuoteSchema.safeParse(expired).success).toBe(false);
        },
      ),
    );
  });

  it("decode and encode any deposit to a recipient of its delivered asset's chain", () => {
    fc.assert(
      fc.property(units, units, epochMs, (amount, least, deadline) => {
        const wire = {
          kind: "bound" as const,
          contract: "fake:1:0x000000e1",
          depositor: "fake:1:0x000000a1",
          recipient: "fake:2:0x000000b1",
          amountIn: { asset: sent, base: amount.toString() },
          minOut: { asset: arrives, base: least.toString() },
          fillDeadlineMs: deadline,
        };
        const decoded = z.decode(decodedDepositSchema, wire);
        expect(z.encode(decodedDepositSchema, decoded)).toStrictEqual(wire);
        const elsewhere = { ...wire, recipient: "fake:1:0x000000b1" };
        expect(decodedDepositSchema.safeParse(elsewhere).success).toBe(false);
      }),
    );
  });

  it("decode and encode any order deposit, and refuse one with no order id", () => {
    fc.assert(
      fc.property(units, fc.stringMatching(/^0x[0-9a-f]{64}$/), (amount, orderId) => {
        const wire = {
          kind: "order" as const,
          contract: "fake:1:0x000000e1",
          depositor: "fake:1:0x000000a1",
          amountIn: { asset: sent, base: amount.toString() },
          orderId,
        };
        expect(z.encode(decodedDepositSchema, z.decode(decodedDepositSchema, wire))).toStrictEqual(
          wire,
        );
        expect(decodedDepositSchema.safeParse({ ...wire, orderId: "" }).success).toBe(false);
      }),
    );
  });
});
