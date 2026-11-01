import type { AccountCode, AccountRef } from "@binference/chain";
import type { FakeAccountCodeReader } from "@binference/chain/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bridgeEngine,
  testFarEntry,
  testRescue,
  testRescueThere,
} from "../bridges/test-bridges.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import {
  holdTestCeiling,
  nextRescue,
  nextRescueThere,
  saveFor,
  setTestRescue,
} from "./test-rescue-bridged.js";

const live = { signal: new AbortController().signal };
const codes: fc.Arbitrary<AccountCode> = fc.constantFrom("none", "delegation", "token", "contract");

// The code each rescue address holds on its own chain and on the destination, and whether either
// chain's reads fail at the change of the rescue address, at the next save, or at both.
interface Drawn {
  readonly here: readonly [AccountCode, AccountCode];
  readonly there: readonly [AccountCode, AccountCode];
  readonly hereDown: readonly [boolean, boolean];
  readonly thereDown: readonly [boolean, boolean];
}

const drawn: fc.Arbitrary<Drawn> = fc.record({
  here: fc.tuple(codes, codes),
  there: fc.tuple(codes, codes),
  hereDown: fc.tuple(fc.boolean(), fc.boolean()),
  thereDown: fc.tuple(fc.boolean(), fc.boolean()),
});

// Each rescue address on the destination, with whether its check could pass: no code anywhere.
function plainOf(world: Drawn): readonly (readonly [AccountRef, boolean])[] {
  return [
    [testRescueThere, world.here[0] === "none" && world.there[0] === "none"],
    [nextRescueThere, world.here[1] === "none" && world.there[1] === "none"],
  ];
}

// Each rescue address the bridge rules hold on the destination though its check could not pass.
function failedHeld(world: Drawn, held: readonly AccountRef[] | undefined): readonly AccountRef[] {
  return plainOf(world)
    .filter(([account, isPlain]) => !isPlain && held?.includes(account) === true)
    .map(([account]) => account);
}

// Each rescue address whose check could pass that the bridge rules do not hold after a write whose
// reads answered on both chains.
function plainMissing(
  world: Drawn,
  seen: { readonly held: readonly AccountRef[] | undefined; readonly at: number },
): readonly AccountRef[] {
  const isRead = world.hereDown[seen.at] !== true && world.thereDown[seen.at] !== true;
  return plainOf(world)
    .filter(([account, isPlain]) => isRead && isPlain && seen.held?.includes(account) !== true)
    .map(([account]) => account);
}

// A chain's code reads fail while `isDown`, and answer again once it is not.
function readsFail(reader: FakeAccountCodeReader, isDown: boolean | undefined): void {
  if (isDown === true) {
    reader.down();
    return;
  }
  reader.up();
}

describe("the rescue address in the bridge rules", () => {
  it("sits in a bridge rule after a write only where its plain-wallet check passed", async () => {
    await fc.assert(
      fc.asyncProperty(drawn, async (world) => {
        const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
        const policy = await holdTestCeiling(bench);
        bench.codesHere.place(testRescue, world.here[0]);
        bench.codesHere.place(nextRescue, world.here[1]);
        bench.codesThere.place(testRescueThere, world.there[0]);
        bench.codesThere.place(nextRescueThere, world.there[1]);
        const held = () => bench.test.ceilings.bridged(policy);
        const steps = [
          async () => setTestRescue(bench, nextRescue),
          async () => saveFor(bench, { address: "0x000000c5" }),
        ];
        for (const [at, step] of steps.entries()) {
          readsFail(bench.codesHere, world.hereDown[at]);
          readsFail(bench.codesThere, world.thereDown[at]);
          // oxlint-disable-next-line eslint/no-await-in-loop -- each change in turn
          await step();
          expect(failedHeld(world, held())).toStrictEqual([]);
        }
        expect(plainMissing(world, { held: held(), at: 1 })).toStrictEqual([]);
        await bench.test.clock.advance(looseningWaitMs);
        await bench.test.engine.settle(live);
        expect(failedHeld(world, held())).toStrictEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
