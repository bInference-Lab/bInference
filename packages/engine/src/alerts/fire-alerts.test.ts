import { accountRefSchema } from "@binference/chain";
import { activityItemSchema, type AlertCondition, launchViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { inOrder } from "../contracts/store-fixtures.js";
import { expectOk, testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
  testChains,
} from "../operations/test-engine.js";
import type { WatchedOrderPrice } from "../orders/order-triggers.js";
import type { WatchedLaunch, WatchedTrade } from "./fire-alerts.js";

const live = { signal: new AbortController().signal };
const wholeToken = 10n ** 6n;
const leader = accountRefSchema.parse("fake:1:0x0000aaaa");
const hash = `0x${"ab".repeat(32)}`;

/** The test token at `micros` micro-dollars a whole token, as the price watcher confirms it. */
function at(micros: bigint): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
    readAtMs: 0,
  };
}

/** A trade of the leader worth `usd` dollars, as the leader watcher would hand it. */
function trade(side: "buy" | "sell", usd: number): WatchedTrade {
  const activity = activityItemSchema.parse({
    at: 1,
    block: 7,
    tx: hash,
    side,
    asset: testToken,
    amount: "5000000",
    counterAsset: testCoin,
    counterAmount: "1000000000000000000",
    valueUsdMicros: String(usd * 1_000_000),
    shareSoldBps: 4_000,
  });
  return { account: leader, activity, assets: {} };
}

/** A launch with `insiders` insider wallets, as the launch feed would hand it. */
function launch(insiders: number): WatchedLaunch {
  const view = launchViewSchema.parse({
    chain: "fake:1",
    token: "fake:1/token:0x0000cafe",
    launchpad: "fake",
    creator: "fake:1:0x0000beef",
    quoteToken: testCoin,
    taxBps: 100,
    curveProgressBps: 4_200,
    graduated: false,
    insiders: Array.from({ length: insiders }, (_, index) => `fake:1:0x0000000${String(index)}`),
    creatorLaunches30d: 0,
    block: 9,
    tx: hash,
    launchedAt: 1_800_000_000_000 - 180_000,
  });
  const assets = { [view.token]: { symbol: "PEPE", name: "Pepe", decimals: 18, verified: false } };
  return { launch: view, assets };
}

interface AlertExtra {
  readonly wake?: boolean;
  readonly expiresAt?: number;
}

async function setAlert(test: TestEngine, condition: AlertCondition, extra: AlertExtra = {}) {
  const args = { agent: testAgent, condition, ...extra };
  return expectOk(await test.engine.handlers["alert/create"](testCall(args)));
}

function pushed(test: TestEngine, kind: string): readonly unknown[] {
  return test.pushes.filter((push) => push.kind === kind).map((push) => push.data);
}

async function untaken(test: TestEngine) {
  return test.stores.agentInbox.untaken({ agentId: testAgent, limit: 200 }, live);
}

const tokenInfo = assetInfosOf(testChains(), [testToken]);

// The one wake-up waiting in the agent inbox, with the session and the turn it reserved.
function wakeUpOf(messages: readonly AgentInboxMessage[]) {
  const [message, ...more] = messages;
  if (message?.turnId === undefined || more.length > 0) {
    throw new Error("Expected one wake-up with its turn.");
  }
  return { id: message.id, session: message.sessionId, turn: message.turnId };
}

const below = (price: bigint, asset = testToken): AlertCondition => ({
  kind: "price",
  asset,
  direction: "below",
  price,
});

describe("price alerts", () => {
  it("fire once at their level on a confirmed price, and send no transaction", async () => {
    const test = await startTestEngine();
    const alert = await setAlert(test, below(900_000n));

    const above = await test.engine.alerts.seePrice(at(900_001n), live);
    const atLevel = await test.engine.alerts.seePrice(at(850_000n), live);
    const again = await test.engine.alerts.seePrice(at(800_000n), live);

    expect([above, again]).toStrictEqual([[], []]);
    expect(atLevel).toStrictEqual([
      {
        alert: alert.alert,
        agent: testAgent,
        at: test.clock.now(),
        fired: { kind: "price", asset: testToken, priceUsdMicros: 850_000n },
        woke: false,
        assets: tokenInfo,
      },
    ]);
    const stored = await test.stores.alerts.get(alert.alert, live);
    expect([stored?.state, stored?.fires]).toStrictEqual(["fired", 1]);
    expect(pushed(test, "alert/fired")).toHaveLength(1);
    expect(pushed(test, "notice/new")).toStrictEqual([
      {
        key: "notice.alertPrice",
        agent: testAgent,
        values: { token: "TKN", direction: "below", price: "$0.90", now: "$0.85" },
        assets: tokenInfo,
      },
    ]);
    expect([pushed(test, "intent/created"), test.executor.taken()]).toStrictEqual([[], []]);
  });

  it("judge only their own token", async () => {
    const test = await startTestEngine();
    await setAlert(test, below(900_000n, testCoin));

    expect(await test.engine.alerts.seePrice(at(1n), live)).toStrictEqual([]);
  });
});

describe("wake-ups", () => {
  it("store one marked wake-up that starts one turn", async () => {
    const test = await startTestEngine();
    const alert = await setAlert(test, below(900_000n), { wake: true });

    const [fired] = await test.engine.alerts.seePrice(at(800_000n), live);
    const messages = await untaken(test);

    expect(fired?.woke).toBe(true);
    expect(messages.map(({ kind, turnId }) => [kind, turnId !== undefined])).toStrictEqual([
      ["inbox/alertFired", true],
    ]);
    expect(messages[0]?.payload).toMatchObject({
      alert: { alert: alert.alert, state: "fired", fires: 1 },
      fired: { kind: "price", priceUsdMicros: "800000" },
      outsideContent: true,
    });
    expect(pushed(test, "notice/new")).toMatchObject([
      { key: "notice.alertPrice", after: [{ key: "alert.woke", values: { agent: "main" } }] },
    ]);
  });

  it("start the turn the wake-up reserved, and none of a frozen agent", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    await setAlert(test, below(900_000n), { wake: true });
    await test.engine.alerts.seePrice(at(800_000n), live);
    const woke = wakeUpOf(await untaken(test));
    const turn = { agent: testAgent, session: woke.session, turn: woke.turn };
    const start = async () =>
      handlers["turn/start"](
        testCall({ ...turn, messages: [woke.id], outsideContent: true }, testCallers.runtime),
      );

    expect(await start()).toMatchObject({ ok: true });
    const ended = await handlers["turn/end"](
      testCall({ agent: testAgent, turn: woke.turn, outcome: "ok" }, testCallers.runtime),
    );
    expect(ended).toMatchObject({ ok: true });
    expectOk(await handlers["safety/freeze"](testCall({ agent: testAgent })));
    expect(await start()).toStrictEqual({ ok: false, error: "agent.frozen" });
  });

  it("are skipped while the agent is frozen, and the owner still hears the fire", async () => {
    const test = await startTestEngine();
    await setAlert(test, below(900_000n), { wake: true });
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));

    const [fired] = await test.engine.alerts.seePrice(at(800_000n), live);

    expect(fired?.woke).toBe(false);
    expect(await untaken(test)).toStrictEqual([]);
    expect(pushed(test, "notice/new")).toContainEqual(
      expect.objectContaining({ key: "notice.alertPrice" }),
    );
  });

  it("hold back the 11th in an hour and count it in the next notice", async () => {
    const test = await startTestEngine();
    const trades = Array.from({ length: 11 }, () => trade("buy", 50));
    await setAlert(test, { kind: "wallet", account: leader }, { wake: true });
    // Each wake-up is taken at once, so none waits to be replaced.
    const fires = await inOrder(trades, async (each) => {
      const [fired] = await test.engine.alerts.seeTrade(each, live);
      const ids = (await untaken(test)).map(({ id }) => id);
      await test.stores.agentInbox.take({ ids: [...ids], atMs: test.clock.now() }, live);
      await test.clock.advance(60_000);
      return fired?.woke;
    });
    await test.clock.advance(3_600_000);
    const [later] = await test.engine.alerts.seeTrade(trade("buy", 50), live);

    expect(fires).toStrictEqual([...Array.from({ length: 10 }, () => true), false]);
    expect([later?.woke, later?.wakeSkipped]).toStrictEqual([true, 1]);
    expect(pushed(test, "notice/new").at(-1)).toMatchObject({
      key: "notice.alertWallet",
      after: [
        { key: "alert.woke", values: { agent: "main" } },
        { key: "alert.wakeSkipped", values: { agent: "main", count: "1" } },
      ],
    });
  });

  it("carry the held count past a wake-up whose notice is held, to the next that goes out", async () => {
    const test = await startTestEngine();
    const other = accountRefSchema.parse("fake:1:0x0000bbbb");
    await setAlert(test, { kind: "wallet", account: leader }, { wake: true });
    await setAlert(test, { kind: "wallet", account: other }, { wake: true });
    const five = Array.from({ length: 5 }, () => undefined);
    // Each alert notifies and wakes five times, the agent's ten wake-ups of the hour.
    await inOrder(five, async () => fireAndTake(test, leader));
    await inOrder(five, async () => fireAndTake(test, other));
    const held = await fireAndTake(test, leader);
    await test.clock.advance(50 * 60_000);
    // The second alert's hour holds its notice; the first alert's hour has ended.
    const unheard = await fireAndTake(test, other);
    const told = await fireAndTake(test, leader);

    expect([held?.woke, unheard?.woke, told?.woke]).toStrictEqual([false, true, true]);
    expect([unheard?.wakeSkipped, told?.wakeSkipped]).toStrictEqual([undefined, 1]);
    expect(pushed(test, "notice/new").at(-1)).toMatchObject({
      key: "notice.alertWallet",
      after: [
        { key: "alert.woke", values: { agent: "main" } },
        { key: "alert.wakeSkipped", values: { agent: "main", count: "1" } },
      ],
    });
  });
});

// Fires a trade of `account`, takes the wake-up it stored as the runtime would, and lets a minute
// pass.
async function fireAndTake(test: TestEngine, account: typeof leader) {
  const [fired] = await test.engine.alerts.seeTrade({ ...trade("buy", 50), account }, live);
  const ids = (await untaken(test)).map(({ id }) => id);
  await test.stores.agentInbox.take({ ids: [...ids], atMs: test.clock.now() }, live);
  await test.clock.advance(60_000);
  return fired;
}

describe("wallet and launch alerts", () => {
  it("fire on each matching trade of the wallet the leader watcher reads", async () => {
    const test = await startTestEngine();
    const condition: AlertCondition = {
      kind: "wallet",
      account: leader,
      side: "sell",
      minUsdMicros: 20_000_000n,
    };
    await setAlert(test, condition);

    const small = await test.engine.alerts.seeTrade(trade("sell", 10), live);
    const buy = await test.engine.alerts.seeTrade(trade("buy", 50), live);
    const first = await test.engine.alerts.seeTrade(trade("sell", 22), live);
    const second = await test.engine.alerts.seeTrade(trade("sell", 30), live);

    expect([small, buy, first.length, second.length]).toStrictEqual([[], [], 1, 1]);
    expect(pushed(test, "notice/new")[0]).toMatchObject({
      key: "notice.alertWallet",
      values: { wallet: "0x0000aaaa", side: "sell", value: "$22.00", share: "40.00%" },
    });
  });

  it("fire on each new launch that passes the filters", async () => {
    const test = await startTestEngine();
    await setAlert(test, { kind: "launch", filters: { maxInsiders: 2 } });

    const crowded = await test.engine.alerts.seeLaunch(launch(3), live);
    const passing = await test.engine.alerts.seeLaunch(launch(1), live);

    expect([crowded, passing.length]).toStrictEqual([[], 1]);
    expect(pushed(test, "notice/new")[0]).toMatchObject({
      key: "notice.alertLaunch",
      parts: {
        launch: {
          key: "launch.line",
          values: { token: "PEPE 0x0000cafe", launchpad: "fake", insiders: "1" },
          parts: { age: { key: "launch.age", values: { unit: "minute", count: "3" } } },
        },
      },
    });
  });
});

describe("expiry", () => {
  it("ends an alert at its expiry, and an ended alert fires no more", async () => {
    const test = await startTestEngine();
    const alert = await setAlert(test, below(900_000n), { expiresAt: test.clock.now() + 1_000 });
    await test.clock.advance(1_000);

    await test.engine.tickOrders(live);

    expect((await test.stores.alerts.get(alert.alert, live))?.state).toBe("ended");
    expect(await test.engine.alerts.seePrice(at(1n), live)).toStrictEqual([]);
  });
});
