import { accountRefSchema } from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import type { AlertCondition } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId, inOrder } from "../contracts/store-fixtures.js";
import { expectOk, testAgent, testAgentDraft, testToken } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testAccount,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { defaultAlertLifetimeMs } from "./alert-rules.js";

const price: AlertCondition = {
  kind: "price",
  asset: testToken,
  direction: "below",
  price: 900_000n,
};

function wallet(n: number): AlertCondition {
  const account = accountRefSchema.parse(`fake:1:0x${n.toString(16).padStart(8, "0")}`);
  return { kind: "wallet", account };
}

interface AlertArgs {
  readonly condition: AlertCondition;
  readonly wake?: boolean;
  readonly expiresAt?: number;
  readonly agent?: Id<"agt">;
}

async function setAlert(test: TestEngine, args: AlertArgs, caller?: EngineCaller) {
  return test.engine.handlers["alert/create"](testCall({ agent: testAgent, ...args }, caller));
}

const refusal = (error: string) => ({ ok: false, error });

describe("alert/create", () => {
  it("stores an active alert at once, with no card and no intent", async () => {
    const test = await startTestEngine();
    const view = expectOk(await setAlert(test, { condition: price, wake: true }));

    expect(view).toStrictEqual({
      alert: view.alert,
      agent: testAgent,
      condition: price,
      state: "active",
      wake: true,
      fires: 0,
      createdAt: test.clock.now(),
    });
    const kinds = new Set(test.pushes.map((push) => push.kind));
    expect([kinds.has("intent/created"), kinds.has("card/opened")]).toStrictEqual([false, false]);
  });

  it("ends a wallet or launch alert in 30 days unless it names its own end", async () => {
    const test = await startTestEngine();
    const now = test.clock.now();
    const walletView = expectOk(await setAlert(test, { condition: wallet(1) }));
    const launch = { kind: "launch", filters: {} } as const;
    const launchView = expectOk(await setAlert(test, { condition: launch, expiresAt: now + 5 }));

    expect([walletView.expiresAt, launchView.expiresAt, walletView.wake]).toStrictEqual([
      now + defaultAlertLifetimeMs,
      now + 5,
      false,
    ]);
  });

  it("marks an alert an outside client or a marked turn set", async () => {
    const test = await startTestEngine();
    const marked = { ...testCallers.runtime, turn: { hasOutsideContent: true } };
    const callers = [testCallers.cli, testCallers.runtime, marked, testCallers.mcp];
    const views = await inOrder(callers, async (caller) =>
      expectOk(await setAlert(test, { condition: price }, caller)),
    );
    const stored = await inOrder(views, async ({ alert }) =>
      test.stores.alerts.get(alert, testCall({})),
    );

    expect(stored.map((record) => record?.outsideContent)).toStrictEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("refuses what it cannot watch, storing nothing", async () => {
    const test = await startTestEngine();
    const now = test.clock.now();
    const tooCheap = { kind: "wallet", account: testAccount, minUsdMicros: 0n } as const;
    const nowhere = { kind: "launch", filters: { launchpads: ["nowhere"] } } as const;
    const asked: readonly AlertArgs[] = [
      { condition: { ...price, price: 0n } },
      { condition: price, expiresAt: now },
      { condition: nowhere },
      { condition: tooCheap },
      { condition: price, agent: fixtureId("agt", 255) },
    ];
    const refused = await inOrder(asked, async (args) => setAlert(test, args));

    expect(refused).toStrictEqual([
      refusal("protocol.bad_args"),
      refusal("protocol.bad_args"),
      refusal("protocol.bad_args"),
      refusal("protocol.bad_args"),
      refusal("agent.not_found"),
    ]);
    const active = await test.stores.alerts.list({ states: ["active"], limit: 10 }, testCall({}));
    expect(active).toStrictEqual([]);
  });

  it("refuses a price alert on a token the price watcher cannot price", async () => {
    const test = await startTestEngine({ unpriceable: [testToken] });

    expect(await setAlert(test, { condition: price })).toStrictEqual(refusal("market.no_data"));
  });

  it("holds 50 active alerts per agent", async () => {
    const test = await startTestEngine();
    const fifty: readonly AlertArgs[] = Array.from({ length: 50 }, () => ({ condition: price }));
    await inOrder(fifty, async (args) => expectOk(await setAlert(test, args)));

    expect(await setAlert(test, { condition: price })).toStrictEqual(refusal("alert.too_many"));
  });

  it("refuses a 51st tracked wallet across the install", async () => {
    const test = await startTestEngine();
    const second = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000aa");
    await test.stores.agents.create(testAgentDraft({ id: second, name: "second" }), testCall({}));
    const first = Array.from({ length: 30 }, (_, index) => ({ condition: wallet(index + 1) }));
    const rest = Array.from({ length: 20 }, (_, index) => ({
      condition: wallet(index + 31),
      agent: second,
    }));
    const asked: readonly AlertArgs[] = [...first, ...rest];
    await inOrder(asked, async (args) => expectOk(await setAlert(test, args)));

    expect(await setAlert(test, { condition: wallet(60) })).toStrictEqual(
      refusal("wallet.track_limit"),
    );
  });
});

describe("alert/list and alert/delete", () => {
  it("pages the agent's alerts and deletes an active one once", async () => {
    const test = await startTestEngine();
    const first = expectOk(await setAlert(test, { condition: price }));
    await test.clock.advance(1);
    const second = expectOk(await setAlert(test, { condition: wallet(1) }));
    const list = test.engine.handlers["alert/list"];
    const page = expectOk(await list(testCall({ agent: testAgent, limit: 1 })));
    const cursor = `${String(first.createdAt)}:${first.alert}`;
    const rest = expectOk(await list(testCall({ cursor, limit: 1 })));
    const remove = test.engine.handlers["alert/delete"];

    expect([page, rest.items]).toStrictEqual([{ items: [first], next: cursor }, [second]]);
    expect(await remove(testCall({ alert: first.alert }))).toStrictEqual({ ok: true, value: {} });
    expect(await remove(testCall({ alert: first.alert }))).toStrictEqual(
      refusal("alert.not_found"),
    );
    const deleted = expectOk(await list(testCall({ state: "deleted" })));
    expect(deleted.items.map(({ alert, state }) => [alert, state])).toStrictEqual([
      [first.alert, "deleted"],
    ]);
  });

  it("lets a client with propose alone delete only the alerts it set", async () => {
    const test = await startTestEngine();
    const owners = expectOk(await setAlert(test, { condition: price }));
    const its = expectOk(await setAlert(test, { condition: price }, testCallers.mcp));
    const remove = test.engine.handlers["alert/delete"];

    expect(await remove(testCall({ alert: owners.alert }, testCallers.mcp))).toStrictEqual(
      refusal("auth.scope"),
    );
    expect(await remove(testCall({ alert: its.alert }, testCallers.mcp))).toStrictEqual({
      ok: true,
      value: {},
    });
  });
});
