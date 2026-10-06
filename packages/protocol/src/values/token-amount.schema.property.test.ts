import { isBps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fillSizeSchema, tokenAmountSchema } from "./token-amount.schema.js";

const baseUnits = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const bps = fc.integer({ min: 0, max: 10_000 }).filter(isBps);

describe("tokenAmountSchema", () => {
  it("round-trips any amount in base units or share of the balance", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          baseUnits.map((base) => ({ base }) as const),
          bps.map((percentBps) => ({ percentBps }) as const),
        ),
        (amount) => {
          const wire = z.encode(tokenAmountSchema, amount);
          expect(z.decode(tokenAmountSchema, wire)).toStrictEqual(amount);
        },
      ),
    );
  });

  it("writes base units as a decimal string, never a number", () => {
    fc.assert(
      fc.property(baseUnits, (base) => {
        expect(z.encode(tokenAmountSchema, { base })).toStrictEqual({ base: base.toString() });
      }),
    );
  });

  it("refuses a share outside 0 to 10000 basis points", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: 10_001 })), (percentBps) => {
        expect(tokenAmountSchema.safeParse({ percentBps }).success).toBe(false);
      }),
    );
  });
});

describe("fillSizeSchema", () => {
  it("round-trips a size in base units, micro-dollars or a share", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          baseUnits.map((base) => ({ base }) as const),
          baseUnits.map((usdMicros) => ({ usdMicros }) as const),
          bps.map((percentBps) => ({ percentBps }) as const),
        ),
        (size) => {
          expect(z.decode(fillSizeSchema, z.encode(fillSizeSchema, size))).toStrictEqual(size);
        },
      ),
    );
  });
});
