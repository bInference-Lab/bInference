import { err, ok } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Ceiling, DayCap } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import { askPrivy, type CustodySetup, setUp, tearDown } from "../contracts/privy-custody-setup.js";
import type { AggregationRemoval } from "../privy/aggregations.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import { oneBnbWei, swapData, testAddresses, testCapPlan } from "./custody-fixtures.js";
import { createAggregation, windowSum } from "./fake-aggregations.js";
import { createFakeCustodySubject, type FakeCustodySubject } from "./fake-custody-subject.js";
import type { FakePrivyState } from "./fake-privy-state.js";

const dayMs = 86_400_000;
const { router, rescue } = testAddresses;

function stateOf(): FakePrivyState {
  return {
    appId: "app",
    origin: "https://api.privy.io",
    clock: createManualClock(1_790_000_000_000),
    random: createSeededRandom(3),
    quorums: new Map(),
    policies: new Map(),
    wallets: new Map(),
    aggregations: new Map(),
    additions: new Map(),
  };
}

// The reference: each addition after the window's start, up to now, summed one by one.
function sumInside(
  held: readonly { readonly atMs: number; readonly value: bigint }[],
  window: { readonly seconds: number; readonly nowMs: number },
): bigint {
  let sum = 0n;
  for (const item of held) {
    const after = item.atMs > window.nowMs - window.seconds * 1_000;
    sum += after && item.atMs <= window.nowMs ? item.value : 0n;
  }
  return sum;
}

// The aggregation the ceiling's first call rule names: the native coin's.
function nativeAggregationOf(ceiling: Ceiling): string {
  const reference = ceiling.rules[0]?.conditions.find((item) => item.field_source === "reference");
  if (reference === undefined) {
    throw new Error("Expected the call rule's cap.");
  }
  return reference.field.slice("aggregation.".length);
}

const nativeBody = {
  name: "native",
  method: "eth_signTransaction",
  metric: { field: "value", field_source: "ethereum_transaction", function: "sum" },
  window: { type: "rolling", seconds: 86_400 },
};

// A delete of an aggregation the subject's owner key owns, signed by it, valid for a minute.
function removalOf(subject: FakeCustodySubject, aggregation: PrivyId): AggregationRemoval {
  return {
    aggregation,
    authorize: subject.ownerAuthorize,
    expiresAtMs: subject.clock.now() + 60_000,
  };
}

describe("the fake's aggregations", () => {
  it("sums exactly the additions of the rolling window that ends now", () => {
    const additions = fc.array(
      fc.record({
        atMs: fc.integer({ min: 0, max: 5 * dayMs }),
        value: fc.bigInt({ min: 0n, max: 10n ** 30n }),
      }),
      { maxLength: 40 },
    );
    fc.assert(
      fc.property(
        additions,
        fc.integer({ min: 3_600, max: 259_200 }),
        fc.integer({ min: 0, max: 5 * dayMs }),
        (held, seconds, nowMs) => {
          expect(windowSum(held, { seconds, nowMs })).toBe(sumInside(held, { seconds, nowMs }));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("takes a sum over 1 to 72 hours, refuses another body, and keeps at most 10", () => {
    const state = stateOf();
    const made = Array.from({ length: 10 }, () => createAggregation(state, nativeBody).status);
    expect(made.every((status) => status === 200)).toBe(true);
    expect(createAggregation(state, nativeBody).status).toBe(400);

    const fresh = stateOf();
    const short = { ...nativeBody, window: { type: "rolling", seconds: 3_599 } };
    const grouped = {
      ...nativeBody,
      group_by: [{ field: "to", field_source: "ethereum_transaction" }],
    };
    const owned = { ...nativeBody, owner_id: "nosuchquorum" };
    const noAbi = {
      ...nativeBody,
      metric: { field: "approve.amount", field_source: "ethereum_calldata", function: "sum" },
    };
    for (const body of [short, grouped, owned, noAbi]) {
      expect(createAggregation(fresh, body).status).toBe(400);
    }
  });
});

describe("the ceiling's 24-hour native cap on the fake", () => {
  it("refuses a venue call once what the wallets sent would pass it, until the day rolls", async () => {
    const subject = createFakeCustodySubject(5);
    const setup = await setUp(subject);
    const call = { to: router, valueWei: oneBnbWei, data: swapData(5n) };
    const nearCap = testCapPlan.nativeLimitBase - oneBnbWei / 2n;

    expect(
      (await askPrivy(setup, { call: { to: rescue, valueWei: nearCap, data: "0x" } })).ok,
    ).toBe(true);
    expect(await askPrivy(setup, { call })).toStrictEqual(err("refused"));
    expect((await askPrivy(setup, { call: { ...call, valueWei: 0n } })).ok).toBe(true);

    await subject.clock.advance(dayMs);
    expect((await askPrivy(setup, { call })).ok).toBe(true);
  });

  it("refuses every venue call once its aggregation is deleted", async () => {
    const subject = createFakeCustodySubject(6);
    const setup = await setUp(subject);
    const call = { to: router, valueWei: 0n, data: swapData(5n) };
    expect((await askPrivy(setup, { call })).ok).toBe(true);

    const id = nativeAggregationOf(setup.expected.ceiling);
    expect(isPrivyId(id)).toBe(true);
    const removal = removalOf(subject, id as PrivyId);
    const live = { signal: AbortSignal.timeout(5_000) };
    await expect(subject.api.deleteAggregation(removal, live)).resolves.toStrictEqual(
      ok(undefined),
    );
    await expect(subject.api.deleteAggregation(removal, live)).resolves.toStrictEqual(
      err("not_found"),
    );
    expect(await askPrivy(setup, { call })).toStrictEqual(err("refused"));
  });

  it("deletes an aggregation only with its owner's signature, before the request expires", async () => {
    const subject = createFakeCustodySubject(8);
    const setup = await setUp(subject);
    const id = nativeAggregationOf(setup.expected.ceiling) as PrivyId;
    const live = { signal: AbortSignal.timeout(5_000) };
    const stranger = createFakeCustodySubject(9).ownerAuthorize;

    await expect(
      subject.api.deleteAggregation({ ...removalOf(subject, id), authorize: stranger }, live),
    ).resolves.toStrictEqual(err("refused"));
    await expect(
      subject.api.deleteAggregation(
        { ...removalOf(subject, id), expiresAtMs: subject.clock.now() - 1 },
        live,
      ),
    ).rejects.toMatchObject({ code: "custody.request_expired" });
    const call = { to: router, valueWei: 0n, data: swapData(5n) };
    expect((await askPrivy(setup, { call })).ok).toBe(true);
  });
});

// The aggregations the suite's wallet names in its ceiling.
function capsOf(setup: CustodySetup): readonly DayCap[] {
  const [held] = readCeiling(setup.expected.ceiling.rules.map(policyRuleJson))?.caps ?? [];
  return held === undefined ? [] : [held.caps.native, ...held.caps.approvals];
}

describe("the custody suite's cleanup", () => {
  it("deletes every aggregation its setup made, so a live app never fills up", async () => {
    const subject = createFakeCustodySubject(7);
    const ids = capsOf(await setUp(subject));
    expect(ids).toHaveLength(1 + testCapPlan.approvals.length);
    await tearDown(subject);
    const live = { signal: AbortSignal.timeout(5_000) };
    const again = await Promise.all(
      ids.map(async ({ aggregation }) =>
        subject.api.deleteAggregation(removalOf(subject, aggregation as PrivyId), live),
      ),
    );
    expect(again).toStrictEqual(ids.map(() => err("not_found")));
    await expect(tearDown(subject)).resolves.toBeUndefined();
  });
});
