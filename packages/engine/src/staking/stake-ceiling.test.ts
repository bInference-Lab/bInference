import { chainRefSchema } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { readOf } from "../fakes/fake-ceiling-read.js";
import type { CallCap } from "../install/ceiling-change.js";
import { ownCapCallOf, storedStakeCap } from "./stake-ceiling.js";
import { testStakingFake, withOwnCap } from "./test-stakes.js";

const chain = chainRefSchema.parse("fake:1");
const oneCoin = 10n ** 18n;
const delegate = { functionName: "delegate", maxValueBase: 100n * oneCoin };

function payable(name: string): JsonValue {
  return { type: "function", name, inputs: [], outputs: [], stateMutability: "payable" };
}

// The fake venue declaring, on its one contract, the calls given, each with the cap given.
function declaring(calls: readonly { readonly abi: JsonValue; readonly maxValueBase?: bigint }[]) {
  const venue = testStakingFake();
  const declared = calls.map((call) => ({ contract: "hub", walletInputs: [], ...call }));
  const [hub] = venue.contracts;
  return { ...venue, contracts: hub === undefined ? [] : [{ ...hub, calls: declared }] };
}

function ceilingOf(ownCaps?: readonly CallCap[]) {
  const calls = {
    contracts: [],
    perTxNativeBase: oneCoin,
    ...(ownCaps === undefined ? {} : { ownCaps }),
  };
  return readOf([], [chain], { calls, bridges: {} });
}

describe("a staking venue's call with a cap of its own (decision 0325)", () => {
  it("is the declared call with its cap", () => {
    expect(ownCapCallOf(withOwnCap(testStakingFake()), chain)).toStrictEqual(delegate);
  });

  it("is none for a venue whose calls carry no cap, or are declared on another chain", () => {
    const uncapped = declaring([{ abi: payable("delegate") }]);
    const elsewhere = chainRefSchema.parse("fake:9");

    expect(ownCapCallOf(uncapped, chain)).toBeUndefined();
    expect(ownCapCallOf(withOwnCap(testStakingFake()), elsewhere)).toBeUndefined();
  });

  it("leads with the largest cap of several, and passes over a call its ABI names nothing", () => {
    const venue = declaring([
      { abi: payable("deposit"), maxValueBase: 5n * oneCoin },
      { abi: payable("delegate"), maxValueBase: 100n * oneCoin },
      { abi: { type: "function" }, maxValueBase: 500n * oneCoin },
      { abi: payable("restake"), maxValueBase: 20n * oneCoin },
    ]);

    expect(ownCapCallOf(venue, chain)).toStrictEqual(delegate);
  });
});

describe("what one stake may carry under the wallet's stored ceiling", () => {
  it("is the cap the ceiling's rule for the venue's own call holds", () => {
    expect(storedStakeCap(ceilingOf([delegate]), delegate, 1n)).toBe(100n * oneCoin);
  });

  it("is the ceiling's cap per call for a ceiling written before the own caps", () => {
    expect(storedStakeCap(ceilingOf(), delegate, 1n)).toBe(oneCoin);
    expect(storedStakeCap(ceilingOf([delegate]), undefined, 1n)).toBe(oneCoin);
  });

  it("is the wallet facts' cap when no ceiling can be read", () => {
    expect(storedStakeCap(undefined, delegate, 7n)).toBe(7n);
  });
});
