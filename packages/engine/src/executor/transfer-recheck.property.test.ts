import { type Amount } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";
import { holdTestWallet, testNames, testSend, transferSimulator } from "../sends/test-transfers.js";
import { driveUntil, startExecutorBench, tapped } from "./test-executor.js";

const live = { signal: new AbortController().signal };
const coin: Amount = { asset: testCoin, base: 10n ** 15n };

/** What the owner changes between the tap and the queue's take. */
type Change = "none" | "remove" | "level3" | "level2";

/** One confirmed send to a saved address, by address, entry or name, and what changes next. */
interface Case {
  readonly via: "address" | "entry" | "name";
  /** The saved address is still cooling, which only level 2 refuses. */
  readonly isCooling: boolean;
  readonly change: Change;
}

const cases: fc.Arbitrary<Case> = fc.record({
  via: fc.constantFrom("address" as const, "entry" as const, "name" as const),
  isCooling: fc.boolean(),
  change: fc.constantFrom<Change>("none", "remove", "level3", "level2"),
});

// Spec 6, `queue_took`: the policy, run again at the take, pays only what it would pay then: one
// signature, or none.
function signaturesOf({ isCooling, change }: Case): number {
  return change === "none" || (change === "level2" && !isCooling) ? 1 : 0;
}

const targets = {
  address: { address: testSaved.account },
  entry: { entry: testSaved.id },
  name: { name: "alice.bnb" },
} as const;

async function signedAfter(sent: Case): Promise<number> {
  const names = testNames();
  names.set("alice.bnb", { address: testSaved.account });
  const bench = await startExecutorBench({
    hold: true,
    engine: {
      nameResolvers: [names],
      chainSimulator: transferSimulator([{ to: testSaved.account, amount: coin }]),
    },
  });
  holdTestWallet(bench.test);
  const usableAtMs = sent.isCooling ? testNowMs + looseningWaitMs : testSaved.usableAtMs;
  await saveTestAddress(bench.test, { ...testSaved, usableAtMs });
  const intent = await tapped(bench, testSend(targets[sent.via], coin));
  const { agents } = bench.test.stores;
  const level = { level3: 3, level2: 2 } as const;
  if (sent.change === "remove") {
    await agents.removeAddress({ id: testSaved.id, atMs: testNowMs }, live);
  } else if (sent.change !== "none") {
    await bench.test.engine.handlers["sendLevel/set"](
      testCall({ agent: testAgent, level: level[sent.change] }),
    );
  }
  await bench.release();
  await driveUntil(bench, intent, { states: ["reconciled"], blocks: 3 });
  return bench.signed.length;
}

describe("a confirmed send's target at the wallet queue", () => {
  it("is never paid once the address book or the send level forbids it", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (sent) => {
        expect(await signedAfter(sent)).toBe(signaturesOf(sent));
      }),
      { numRuns: 40 },
    );
  });
});
