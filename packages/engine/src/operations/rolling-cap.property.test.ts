import type { IntentView } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ConfirmedIntent } from "../intents/confirmed-intent.js";
import { expectOk, testAgent, testLimits, testSwap } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

const live = { signal: new AbortController().signal };
const dayMs = 86_400_000;
const capUsdMicros = 30n;

/** Swaps proposed together and confirmed at once, after the clock moved on by `gapMs`. */
interface Batch {
  readonly gapMs: number;
  /** Each swap's size: `k` times 10^10 base units of the coin, worth 6k micro-dollars at $600. */
  readonly sizes: readonly number[];
}

interface Run {
  readonly mode: "paper" | "live";
  readonly batches: readonly Batch[];
}

/** A Confirm the engine refused as past the cap: when, and at what value. */
interface Refused {
  readonly atMs: number;
  readonly valueUsdMicros: bigint;
}

const gaps = [0, 1_000, 3_600_000, dayMs / 2, dayMs - 1, dayMs, dayMs + 1];
const runArbitrary: fc.Arbitrary<Run> = fc.record({
  mode: fc.constantFrom("paper", "live"),
  batches: fc.array(
    fc.record({
      gapMs: fc.constantFrom(...gaps),
      sizes: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
});

const answeredBy = { surface: "cli", by: "dev_1" } as const;

async function proposeAll(test: TestEngine, sizes: readonly number[]) {
  return sizes.reduce<Promise<readonly IntentView[]>>(async (earlier, k) => {
    const request = testSwap({ amount: { base: BigInt(k) * 10n ** 10n } });
    const proposed = await test.engine.handlers["intent/propose"](testCall(request));
    return [...(await earlier), expectOk(proposed)];
  }, Promise.resolve([]));
}

// Proposes the batch's swaps one by one, then confirms them all at once, as taps that land
// together; it gives back the ones refused as past the cap.
async function confirmBatch(test: TestEngine, batch: Batch): Promise<readonly Refused[]> {
  await test.clock.advance(batch.gapMs);
  const views = await proposeAll(test, batch.sizes);
  const answers = await Promise.all(
    views.map(async ({ intent }) =>
      test.engine.answer({ intent, decision: "confirm", cardVersion: 1, answeredBy }, live),
    ),
  );
  return answers.flatMap((answer) => {
    const { outcome, intent } = expectOk(answer);
    const valueUsdMicros = intent.record.valueUsdMicros ?? 0n;
    return outcome.verdict === "over_cap" ? [{ atMs: test.clock.now(), valueUsdMicros }] : [];
  });
}

// What the confirmations of the 24 hours up to `endMs` hold, the window's start included as the
// policy counts it.
function heldAt(confirmed: readonly ConfirmedIntent[], endMs: number): bigint {
  return confirmed
    .filter(({ confirmedAtMs }) => confirmedAtMs >= endMs - dayMs && confirmedAtMs <= endMs)
    .reduce((sum, { valueUsdMicros }) => sum + (valueUsdMicros ?? 0n), 0n);
}

async function confirmRun(test: TestEngine, run: Run): Promise<readonly Refused[]> {
  return run.batches.reduce<Promise<readonly Refused[]>>(
    async (earlier, batch) => [...(await earlier), ...(await confirmBatch(test, batch))],
    Promise.resolve([]),
  );
}

describe("the rolling 24-hour cap", () => {
  it("lets no window hold confirmations past the cap, and refuses only what would pass it", async () => {
    await fc.assert(
      fc.asyncProperty(runArbitrary, async (run) => {
        const limits = {
          ...testLimits,
          perTradeUsdMicros: capUsdMicros,
          rollingDayUsdMicros: capUsdMicros,
        };
        const test = await startTestEngine({ agent: { mode: run.mode, limits } });
        const refused = await confirmRun(test, run);
        const query = { agentId: testAgent, isPaper: run.mode === "paper", fromMs: 0 };
        const confirmed = await test.stores.intents.confirmedSince(query, live);
        // The heaviest window ends at a confirmation, so those are the windows to weigh.
        const heaviest = confirmed.map(({ confirmedAtMs }) => heldAt(confirmed, confirmedAtMs));
        expect(heaviest.filter((held) => held > capUsdMicros)).toStrictEqual([]);
        const unfounded = refused.filter(
          ({ atMs, valueUsdMicros }) => heldAt(confirmed, atMs) + valueUsdMicros <= capUsdMicros,
        );
        expect(unfounded).toStrictEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
