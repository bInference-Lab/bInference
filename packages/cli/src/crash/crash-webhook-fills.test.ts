import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import { intentStates } from "@binference/engine";
import type { ProtocolId } from "@binference/protocol";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import { connectClient } from "../e2e/test-host.js";
import { createSystemHttp } from "../runtime/system-http.js";
import type { CrashContext } from "./crash-context.js";
import { armKillWith, restartWith, storyOf, useCrashHarness } from "./crash-harness.js";
import { crashUsdtAsset } from "./crash-orders.js";
import { withStore } from "./crash-reads.js";
import { type CrashInstall, setUpCrashInstall } from "./crash-runs.js";

// Each run makes a paper webhook rule on a fresh install as the owner does, confirms its card,
// posts one alert to the rule's URL, and kills the engine outright once the alert's fill stored
// its intent and simulates it, before the fill's write; a second engine on the same folder
// repairs what the stop left. A paper fill signs and sends nothing, so the run proves the alert's
// end: its one intent cancelled, its row ended once, and the rule counting no fill.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 59 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const call = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });
const http = createSystemHttp({ version: "crash" });

/** A run's rule: its id, its URL and the agent it fills for. */
interface CrashRule {
  readonly rule: Id<"whr">;
  readonly url: string;
}

// The owner resets the paper portfolio, makes a rule that buys 0.001 BNB of USDT on each alert
// and confirms its card, as from the CLI.
async function ruleOf(install: CrashInstall): Promise<CrashRule> {
  const client = await connectClient(install.machine);
  try {
    const [agent] = (await client.call("engine/status", {}, call())).agents;
    if (agent === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    await client.call("portfolio/resetPaper", { agent: agent.id }, call());
    const request = {
      agent: agent.id,
      name: "USDT on each alert",
      token: crashUsdtAsset,
      side: "buy",
      size: { base: 10n ** 15n },
      ratePerMinute: 5,
    } as const;
    const created = await client.call("webhookRule/create", request, call());
    const rule = idSchema("whr").parse(created.rule);
    const stored = await withStore(install.machine.folder, async (stores, signal) =>
      stores.webhookRules.get(rule, { signal }),
    );
    const intent = stored?.intentId as ProtocolId<"intent">;
    const card = await client.call("intent/card", { intent }, call());
    await client.call(
      "intent/confirm",
      { intent, card: card.card, cardVersion: card.version },
      call(),
    );
    return { rule, url: created.url };
  } finally {
    client.close();
  }
}

// Posts one alert to the rule's URL, at the engine's own webhook port; answers its status.
async function postAlert(install: CrashInstall, rule: CrashRule): Promise<number> {
  const { pathname } = new URL(rule.url);
  const url = `http://127.0.0.1:${String(install.webhookPort)}${pathname}`;
  const answer = await http.request({
    method: "POST",
    url,
    body: "USDT up",
    signal: AbortSignal.timeout(10_000),
  });
  return answer.status;
}

/** What the store holds of the rule's alert, its fill intents and the rule. */
interface AlertBooked {
  /** Each fill intent and its state: the intents of kind `buy`, which only the rule makes. */
  readonly fills: readonly { readonly intent: string; readonly state: string }[];
  /** The alert row's outcome and reason; none while it waits. */
  readonly alert: { readonly outcome?: string; readonly reason?: string; readonly intent?: string };
  readonly ruleFills: number;
}

async function bookedOf(install: CrashInstall, rule: CrashRule): Promise<AlertBooked> {
  return withStore(install.machine.folder, async (stores, signal) => {
    const intents = await stores.intents.list({ states: [...intentStates], limit: 20 }, { signal });
    const [row] = await stores.webhookRules.alerts({ ruleId: rule.rule, limit: 5 }, { signal });
    const record = await stores.webhookRules.get(rule.rule, { signal });
    return {
      fills: intents
        .filter(({ kind }) => kind === "buy")
        .map(({ id, state }) => ({ intent: id, state })),
      alert: {
        ...(row?.outcome === undefined ? {} : { outcome: row.outcome }),
        ...(row?.reason === undefined ? {} : { reason: row.reason }),
        ...(row?.intentId === undefined ? {} : { intent: row.intentId }),
      },
      ruleFills: record?.fills ?? -1,
    };
  });
}

// Waits on the restarted engine until the alert ended, then stops it through `engine/stop`.
async function endedAndStopped(install: CrashInstall, rule: CrashRule): Promise<void> {
  const deadline = Date.now() + 60_000;
  const poll = async (): Promise<void> => {
    const { alert } = await bookedOf(install, rule);
    if (alert.outcome !== undefined || Date.now() > deadline) {
      return;
    }
    await wait(200);
    return poll();
  };
  await poll();
  const client = await connectClient(install.machine);
  try {
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
  } finally {
    client.close();
  }
}

describe("an engine killed during a webhook rule's paper fill, before the fill's write", () => {
  it.each(runs)("ends the alert once and fills it never, run %i", async () => {
    const world = harness.worldOf();
    const install = await setUpCrashInstall(world, harness.folders);
    const first = await harness.startEngine(install);
    const rule = await ruleOf(install);
    const killed = armKillWith(first, "the fill's simulation", async (kill) => {
      await world.chain.holdNextRead((request) => request.method === "eth_simulateV1");
      return kill();
    });
    const posted = await postAlert(install, rule);
    await killed;
    const atKill = await bookedOf(install, rule);
    const settle = async () => endedAndStopped(install, rule);
    const second = await restartWith(harness, install, {
      isMinedAfterResend: false,
      fills: false,
      settle,
    });
    const after = await bookedOf(install, rule);
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
