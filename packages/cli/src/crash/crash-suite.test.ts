import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { CrashContext } from "./crash-context.js";
import { useCrashHarness } from "./crash-harness.js";
import {
  crashIntentOnce,
  oneStepKillCases,
  sentOnceOf,
  sentSummaryOf,
} from "./crash-intent-runs.js";
import { buyCrashUsdt } from "./crash-runs.js";

// Each run sets up a state folder with `binference init` and starts `binference start` on it as a
// program of its own, on the suite's one anvil chain: the owner goes live, proposes a swap and
// confirms it, and the test kills the engine outright at the run's kill point (SIGKILL, or
// TerminateProcess on Windows, through the platform's program); a second `binference start` on
// the same folder then recovers. What reached the chain is counted by the test's relays and by
// anvil itself, and the signatures by the test's Privy, never taken from the engine.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 29 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const { signed, stored, relayed, sent, included } = oneStepKillCases;
const swap = { requestOf: buyCrashUsdt, executions: 1 } as const;

describe.each([signed, stored, relayed, sent, included])(
  "an engine killed at $point and started again",
  (killCase) => {
    it.each(runs)("sends one transaction at most, run %i", async () => {
      const outcome = await crashIntentOnce(harness, swap, killCase);
      // A failed run shows what both engines reported and what the engine log holds.
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      expect(sentSummaryOf(outcome)).toStrictEqual(sentOnceOf(killCase, swap));
    });
  },
);
