import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { CrashContext } from "./crash-context.js";
import { armKillWith, restartWith, storyOf, useCrashHarness } from "./crash-harness.js";
import { setUpCrashInstall } from "./crash-runs.js";
import {
  alertBookedOf,
  alertEndedAndStopped,
  crashRuleOf,
  postCrashAlert,
} from "./crash-webhook-rules.js";

// Each run makes a paper webhook rule on a fresh install as the owner does, confirms its card,
// posts one alert to the rule's URL, and kills the engine outright once the alert's fill stored
// its intent and simulates it, before the fill's write; a second engine on the same folder
// repairs what the stop left. A paper fill signs and sends nothing, so the run proves the alert's
// end: its one intent cancelled, its row ended once, and the rule counting no fill.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 59 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);

describe("an engine killed during a webhook rule's paper fill, before the fill's write", () => {
  it.each(runs)("ends the alert once and fills it never, run %i", async () => {
    const world = harness.worldOf();
    const install = await setUpCrashInstall(world, harness.folders);
    const first = await harness.startEngine(install);
    const rule = await crashRuleOf(install, { isLive: false });
    const killed = armKillWith(first, "the fill's simulation", async (kill) => {
      await world.chain.holdNextRead((request) => request.method === "eth_simulateV1");
      return kill();
    });
    const posted = await postCrashAlert(install, rule);
    await killed;
    const atKill = await alertBookedOf(install, rule);
    const settle = async () => alertEndedAndStopped(install, rule);
    const second = await restartWith(harness, install, {
      isMinedAfterResend: false,
      fills: false,
      settle,
    });
    const after = await alertBookedOf(install, rule);
    const story = await storyOf(install.machine.folder, [first, second.engine]);
    onTestFailed(() => {
      process.stderr.write(`${story}\n`);
    });
    const intents = atKill.fills.map(({ intent }) => intent);
    // The stop came after the fill stored its intent and before its write: nothing filled yet.
    expect({
      posted,
      alert: atKill.alert,
      ruleFills: atKill.ruleFills,
      isFilled: atKill.fills.map(({ state }) => state === "paper_filled"),
    }).toStrictEqual({ posted: 202, alert: {}, ruleFills: 0, isFilled: [false] });
    expect(await second.engine.program.exited).toBe(0);
    expect(after).toStrictEqual({
      fills: intents.map((intent) => ({ intent, state: "cancelled" })),
      alert: { outcome: "skipped", reason: "fill_failed", intent: intents[0] },
      ruleFills: 0,
    });
    expect(world.chain.sends().filter(({ from }) => from === install.from)).toStrictEqual([]);
  });
});
