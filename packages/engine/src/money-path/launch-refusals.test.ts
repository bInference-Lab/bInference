import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCall, testCallers } from "../operations/test-engine.js";
import { proposeIntent, testLaunch, testLaunchEngine } from "./test-launches.js";

// A launchpad names why it cannot take a launch, so the owner reads the next step (decision 0284).
describe("a launch its launchpad refuses for a reason it names", () => {
  it.each(["launch_paused", "start_unpriced", "start_unreachable", "dry_run_failed"] as const)(
    "ends failed_check with %s before any upload",
    async (reason) => {
      const { test, launcher } = await testLaunchEngine({ quoteFails: reason });
      const view = await proposeIntent(test, testLaunch);
      expect([view.state, view.outcome?.reason]).toStrictEqual(["failed_check", reason]);
      expect(launcher.uploads()).toStrictEqual([]);
    },
  );

  it.each([
    ["recipient_needed", "intent.launch_recipient_needed"],
    ["recipient_unused", "intent.launch_recipient_unused"],
  ] as const)("fails with its own error when the settings are %s", async (refusal, code) => {
    const { test } = await testLaunchEngine({ refusesSettings: refusal });
    const answer = await test.engine.handlers["intent/propose"](
      testCall(testLaunch, testCallers.cli),
    );
    expect(answer).toStrictEqual(err(code));
  });
});
