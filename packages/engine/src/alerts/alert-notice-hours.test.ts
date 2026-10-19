import { accountRefSchema } from "@binference/chain";
import { activityItemSchema, type AlertCondition } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { inOrder } from "../contracts/store-fixtures.js";
import { expectOk, testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import type { AgentStore } from "../ports.js";
import type { WatchedTrade } from "./fire-alerts.js";

const live = { signal: new AbortController().signal };
const leader = accountRefSchema.parse("fake:1:0x0000aaaa");
const minuteMs = 60_000;

// A buy of the leader worth $50, from `account` as the leader watcher hands it.
function buyBy(account: string): WatchedTrade {
  const activity = activityItemSchema.parse({
    at: 1,
    block: 7,
    tx: `0x${"ab".repeat(32)}`,
    side: "buy",
    asset: testToken,
    amount: "5000000",
    counterAsset: testCoin,
    counterAmount: "1000000000000000000",
    valueUsdMicros: "50000000",
  });
  return { account: accountRefSchema.parse(account), activity, assets: {} };
}

async function watchLeader(test: TestEngine): Promise<void> {
  const condition: AlertCondition = { kind: "wallet", account: leader };
  expectOk(await test.engine.handlers["alert/create"](testCall({ agent: testAgent, condition })));
}

function notices(test: TestEngine) {
  return test.pushes.filter(({ kind }) => kind === "notice/new").map(({ data }) => data);
}

// The agent store, answering the test agent as archived once `retired` says so.
function retiring(retired: { readonly current: boolean }): (store: AgentStore) => AgentStore {
  return (store) => ({
    ...store,
    get: async (id, call) => {
      const settings = await store.get(id, call);
      return settings === undefined || !retired.current
        ? settings
        : { ...settings, agent: { ...settings.agent, archivedAtMs: 1 } };
    },
  });
}

describe("an alert's notices", () => {
  it("go out five an hour; the rest are told in one line once the hour ends", async () => {
    const test = await startTestEngine();
    await watchLeader(test);
    const seven = Array.from({ length: 7 }, () => buyBy(leader));
    await inOrder(seven, async (each) => {
      await test.engine.alerts.seeTrade(each, live);
      await test.clock.advance(minuteMs);
    });
    await test.engine.tickOrders(live);
    const withinTheHour = notices(test);
    await test.clock.advance(60 * minuteMs);
    await test.engine.tickOrders(live);
    await test.engine.tickOrders(live);

    const wallet = { key: "notice.alertWallet" };
    expect(withinTheHour).toMatchObject([wallet, wallet, wallet, wallet, wallet]);
    expect(notices(test).slice(5)).toStrictEqual([
      { key: "notice.alertHeld", agent: testAgent, values: { count: "2" } },
    ]);
    expect(test.pushes.filter(({ kind }) => kind === "alert/fired")).toHaveLength(7);
  });

  it("match a wallet whatever case its watcher hands the address in", async () => {
    const test = await startTestEngine();
    await watchLeader(test);

    const fired = await test.engine.alerts.seeTrade(buyBy("fake:1:0x0000AAAA"), live);

    expect(fired).toHaveLength(1);
  });
});

describe("an archived agent's alert", () => {
  it("ends at its next match, unheard, and fires nothing", async () => {
    const retired = { current: false };
    const test = await startTestEngine({ agents: retiring(retired) });
    await watchLeader(test);
    retired.current = true;

    const fired = await test.engine.alerts.seeTrade(buyBy(leader), live);

    const [alert] = await test.stores.alerts.list({ states: ["ended"], limit: 1 }, live);
    expect([fired, alert?.fires, notices(test)]).toStrictEqual([[], 0, []]);
  });
});
