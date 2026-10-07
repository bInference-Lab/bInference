import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs, testSwap } from "../intents/test-intents.js";
import type { AgentStore } from "../ports.js";
import { startTestEngine, type TestEngine, testCall, testCallers } from "./test-engine.js";

const live = { signal: new AbortController().signal };
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
// A wallet the custodian holds no account for.
const unheldWallet = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"wal">;

// An agent store whose first `losses` mode changes lose their race to another write on the row.
function racing(losses: number): (store: AgentStore) => AgentStore {
  return (store) => {
    let lost = 0;
    return {
      ...store,
      async setMode(change, options) {
        if (lost < losses) {
          lost += 1;
          await store.setMode({ ...change, mode: "paper" }, options);
        }
        return store.setMode(change, options);
      },
    };
  };
}

async function modeOf(test: TestEngine): Promise<string | undefined> {
  return (await test.stores.agents.get(testAgent, live))?.agent.mode;
}

describe("the live switch", () => {
  it("keeps the agent on paper through every operation but agent/goLive", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const modes: (string | undefined)[] = [];
    const first = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    modes.push(await modeOf(test));
    const card = first.card?.card as Id<"crd">;
    await handlers["intent/confirm"](testCall({ intent: first.intent, card, cardVersion: 1 }));
    modes.push(await modeOf(test));
    const second = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    const denied = { intent: second.intent, card: second.card?.card as Id<"crd"> };
    await handlers["intent/deny"](testCall(denied));
    modes.push(await modeOf(test));
    await handlers["portfolio/resetPaper"](testCall({ agent: testAgent }));
    await handlers["agent/goPaper"](testCall({ agent: testAgent }));
    await handlers["ledger/list"](testCall({}));
    modes.push(await modeOf(test));
    expect(modes).toStrictEqual(["paper", "paper", "paper", "paper"]);
    const view = expectOk(await handlers["agent/goLive"](testCall({ agent: testAgent })));
    expect([view.mode, await modeOf(test)]).toStrictEqual(["live", "live"]);
  });

  it("refuses to go live before the default wallet holds funds, and stays on paper", async () => {
    const empty = await startTestEngine({ facts: { nativeBalanceBase: 0n } });
    const none = await startTestEngine({ wallets: [] });
    const unheld = await startTestEngine({ wallets: [unheldWallet], paper: [] });
    const goLive = testCall({ agent: testAgent });
    expect([
      await empty.engine.handlers["agent/goLive"](goLive),
      await none.engine.handlers["agent/goLive"](goLive),
      await unheld.engine.handlers["agent/goLive"](goLive),
    ]).toStrictEqual([err("wallet.unfunded"), err("wallet.unfunded"), err("wallet.unfunded")]);
    expect([await modeOf(empty), await modeOf(none), await modeOf(unheld)]).toStrictEqual([
      "paper",
      "paper",
      "paper",
    ]);
  });

  it("journals each switch with who made it and where, and announces it", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    await test.clock.advance(5_000);
    expectOk(await handlers["agent/goLive"](testCall({ agent: testAgent })));
    expectOk(await handlers["agent/goLive"](testCall({ agent: testAgent })));
    const device = { ...testCallers.cli, credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001" };
    const console = { ...device, client: { kind: "console", version: "test" } } as const;
    expectOk(await handlers["agent/goPaper"](testCall({ agent: testAgent }, console)));
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    const change = { atMs: testNowMs + 5_000, path: "agents.main.mode" };
    expect(entries).toStrictEqual([
      {
        ...change,
        id: 1,
        by: testCallers.cli.credential,
        surface: "cli",
        before: "paper",
        after: "live",
      },
      {
        ...change,
        id: 2,
        by: device.credential,
        surface: "console",
        before: "live",
        after: "paper",
      },
    ]);
    const announced = test.pushes.filter((push) => push.topic === "config");
    expect(announced.map((push) => [push.kind, push.data])).toStrictEqual(
      entries.map((entry) => ["config/changed", entry]),
    );
  });

  it("brakes back to paper, and the next proposal runs on paper", async () => {
    const test = await startTestEngine({ agent: { mode: "live" } });
    const { handlers } = test.engine;
    const view = expectOk(await handlers["agent/goPaper"](testCall({ agent: testAgent })));
    expect(view).toMatchObject({ agent: testAgent, name: "main", mode: "paper", locale: "en" });
    const proposed = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    expect(proposed.paper).toBe(true);
  });

  it("refuses an agent it does not hold", async () => {
    const { engine } = await startTestEngine();
    const unknown = testCall({ agent: unknownAgent });
    expect([
      await engine.handlers["agent/goLive"](unknown),
      await engine.handlers["agent/goPaper"](unknown),
    ]).toStrictEqual([err("agent.not_found"), err("agent.not_found")]);
  });

  it("reads the agent again after a lost race, and faults after three", async () => {
    const goLive = testCall({ agent: testAgent });
    const once = await startTestEngine({ agents: racing(1) });
    expect(expectOk(await once.engine.handlers["agent/goLive"](goLive)).mode).toBe("live");
    const always = await startTestEngine({ agents: racing(3) });
    await expect(always.engine.handlers["agent/goLive"](goLive)).rejects.toMatchObject({
      code: "engine.agent_stale",
      retryable: true,
    });
  });
});
