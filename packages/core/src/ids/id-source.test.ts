import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createManualClock } from "../fakes/manual-clock.js";
import { createSeededRandom } from "../fakes/seeded-random.js";
import { createIdSource } from "./id-source.js";
import { isId } from "./id.js";

describe("createIdSource", () => {
  it("puts the clock's milliseconds in the first 48 bits", () => {
    const ids = createIdSource({
      clock: createManualClock(0x0190_f1c2_3a4b),
      random: createSeededRandom(1),
    });
    expect(ids.next("int")).toMatch(/^int_0190f1c2-3a4b-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
  });

  it("makes ids that parse under their own prefix for any time and seed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 48 - 1 }),
        fc.integer(),
        fc.constantFrom("tx", "int", "agt", "whr"),
        (time, seed, prefix) => {
          const ids = createIdSource({
            clock: createManualClock(time),
            random: createSeededRandom(seed),
          });
          const id = ids.next(prefix);
          expect(isId(prefix, id)).toBe(true);
          expect(isId("ord", id)).toBe(false);
        },
      ),
    );
  });

  it("refuses a malformed prefix", () => {
    const ids = createIdSource({ clock: createManualClock(), random: createSeededRandom(1) });
    expect(() => ids.next("INT")).toThrow(expect.objectContaining({ code: "core.bad_id_prefix" }));
  });

  it("refuses a Random port that gives too few bytes", () => {
    const ids = createIdSource({
      clock: createManualClock(),
      random: { bytes: () => new Uint8Array(2) },
    });
    expect(() => ids.next("int")).toThrow(expect.objectContaining({ code: "core.bad_random" }));
  });
});
