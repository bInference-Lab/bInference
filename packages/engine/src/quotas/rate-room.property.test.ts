import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rateRoom, rateWindowMs } from "./rate-room.js";

const times = fc.array(fc.integer({ min: 0, max: rateWindowMs }), { maxLength: 40 });
const quotas = fc.integer({ min: 1, max: 20 });

// How many counted times are still in the window that ends at `now`.
function inWindowAt(counted: readonly number[], now: number): number {
  return counted.filter((time) => time > now - rateWindowMs).length;
}

// Whether the time a full room names is the first at which one more fits; a room that fits names
// none, and holds.
function namesTheFirstRoom(counted: readonly number[], quota: number): boolean {
  const room = rateRoom(counted, quota);
  if (room.fits || room.resumesAt === undefined) {
    return room.fits;
  }
  const at = room.resumesAt;
  return inWindowAt(counted, at) < quota && inWindowAt(counted, at - 1) >= quota;
}

describe("rate room, for any times in the window and any quota", () => {
  it("fits exactly while fewer than the quota are counted", () => {
    fc.assert(
      fc.property(times, quotas, (counted: readonly number[], quota: number) => {
        expect(rateRoom(counted, quota).fits).toBe(counted.length < quota);
      }),
    );
  });

  it("leaves room for one more at the time it names, and none a moment before", () => {
    fc.assert(
      fc.property(times, quotas, (counted: readonly number[], quota: number) => {
        expect(namesTheFirstRoom(counted, quota)).toBe(true);
      }),
    );
  });
});
