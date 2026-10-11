import { err, type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { IntentState } from "../intents/intent-state.js";
import { expectOk, testAgent, testAgentDraft, testNowMs } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
  testCallers,
  testChains,
} from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import { secondAgent, setUpRescue } from "./test-rescue.js";

const live = { signal: new AbortController().signal };
const third = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a3");

// The test agent and a second one, each with a wallet in the install.
async function startWithTwoAgents(options: TestEngineOptions = {}): Promise<TestEngine> {
  const test = await startTestEngine(options);
  await setUpRescue(test);
  return test;
}

async function freeze(test: TestEngine, agent?: Id<"agt">) {
  expectOk(
    await test.engine.handlers["safety/freeze"](testCall(agent === undefined ? {} : { agent })),
  );
}

async function unfreeze(test: TestEngine, agent?: Id<"agt">, caller = testCallers.cli) {
  const args = agent === undefined ? {} : { agent };
  return test.engine.handlers["safety/unfreeze"](testCall(args, caller));
}

// The intent of an unfreeze that opened a card.
async function opened(test: TestEngine, agent?: Id<"agt">): Promise<Id<"int">> {
  const { intent } = expectOk(await unfreeze(test, agent));
  if (intent === undefined) {
    throw new Error("Expected an unfreeze card.");
  }
  return intent;
}

// The owner's answer on the intent's current card, from Telegram.
async function tap(test: TestEngine, intent: Id<"int">, decision: "confirm" | "deny") {
  const answeredBy = { surface: "telegram", by: "telegram" } as const;
  return test.engine.answer({ intent, decision, cardVersion: 1, answeredBy }, live);
}

async function stateOf(test: TestEngine, intent: Id<"int">): Promise<IntentState | undefined> {
  return (await test.stores.intents.get(intent, live))?.state;
}

async function frozenTimes(test: TestEngine): Promise<readonly (number | undefined)[]> {
  const agents = await test.stores.agents.list(live);
  return agents.map((agent) => agent.frozenAtMs);
}

async function installFrozenAt(test: TestEngine): Promise<number | undefined> {
  return (await test.stores.install.read(live)).frozenAtMs;
}

function unfrozenNotices(test: TestEngine) {
  return test.pushes
    .filter(({ topic }) => topic === "notice")
    .map(({ data }) => data)
    .filter((data) => JSON.stringify(data).includes("notice.unfrozen"));
}

// The action line the unfreeze's first card version draws.
async function actionOf(test: TestEngine, intent: Id<"int">) {
  const [card] = await test.stores.intents.cards(intent, live);
  if (card === undefined) {
    throw new Error(`Expected intent ${intent} to have a card.`);
  }
  const showings = createCardShowings({
    intents: test.stores.intents,
    agents: test.stores.agents,
    chains: testChains(),
  });
  const shown = await showings.opened({ intent, card: card.id }, live);
  return shown?.card.lines.find(({ key }) => key.startsWith("card.unfreeze."));
}

// An intent store whose first unfreeze write fails, as a stop between the tap and the write does.
function stoppedOnce(store: IntentStore): IntentStore {
  const failed = { count: 0 };
  return {
    ...store,
    async freeze(write, call) {
      failed.count += write.isFrozen ? 0 : 1;
      return failed.count === 1 && !write.isFrozen
        ? Promise.reject(new Error("stopped"))
        : store.freeze(write, call);
    },
  };
}

// An intent store whose unfreeze write another write beats `times` times, each after `between`.
function beaten(
  times: number,
  between: () => Promise<void> = async () => Promise.resolve(),
): (store: IntentStore) => IntentStore {
  const left = { times };
  return (store) => ({
    ...store,
    async freeze(write, call) {
      if (write.isFrozen || left.times === 0) {
        return store.freeze(write, call);
      }
      left.times -= 1;
      await between();
      return err("stale");
    },
  });
}

// The owner's whole-install freeze on the bound engine, as it lands between two writes.
function freezeBetween() {
  const bound: { test?: TestEngine } = {};
  return {
    bind: (test: TestEngine) => {
      bound.test = test;
    },
    between: async () => {
      if (bound.test !== undefined) {
        await freeze(bound.test);
      }
    },
  };
}

describe("safety/unfreeze", () => {
  it("opens a card for a frozen agent, and unfreezes it only on the owner's tap", async () => {
    const test = await startWithTwoAgents();
    await freeze(test, testAgent);
    await test.clock.advance(1_000);
    const intent = await opened(test, testAgent);
    await expect(stateOf(test, intent)).resolves.toBe("awaiting_confirmation");
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs, undefined]);
    await expect(actionOf(test, intent)).resolves.toMatchObject({
      key: "card.unfreeze.agent",
      values: { agent: { type: "text", text: "main" } },
    });
    expectOk(await tap(test, intent, "confirm"));
    await expect(stateOf(test, intent)).resolves.toBe("reconciled");
    await expect(frozenTimes(test)).resolves.toStrictEqual([undefined, undefined]);
    expect(unfrozenNotices(test)).toStrictEqual([
      {
        key: "notice.unfrozen",
        agent: testAgent,
        values: { scope: "agent", agent: "main", surface: "telegram" },
        intent,
      },
    ]);
    const entries = await test.stores.ledger.list({ after: 0, limit: 100 }, live);
    expect(entries.filter(({ kind }) => kind === "unfreeze")).toMatchObject([
      { agentId: testAgent, subject: testAgent, data: { surface: "telegram" } },
    ]);
  });

  it("unfreezes every frozen agent and the install, so a later agent starts unfrozen", async () => {
    const test = await startWithTwoAgents();
    await freeze(test);
    const intent = await opened(test);
    await expect(actionOf(test, intent)).resolves.toMatchObject({
      key: "card.unfreeze.all",
      values: { count: { type: "count", count: 2 } },
    });
    expectOk(await tap(test, intent, "confirm"));
    await expect(frozenTimes(test)).resolves.toStrictEqual([undefined, undefined]);
    await expect(installFrozenAt(test)).resolves.toBeUndefined();
    const later = await test.stores.agents.create(
      testAgentDraft({ id: third, name: "third" }),
      live,
    );
    expect(expectOk(later).agent.frozenAtMs).toBeUndefined();
    expect(unfrozenNotices(test)).toMatchObject([
      { key: "notice.unfrozen", values: { scope: "install", surface: "telegram" }, intent },
    ]);
    const entries = await test.stores.ledger.list({ after: 0, limit: 100 }, live);
    expect(entries.filter(({ kind }) => kind === "unfreeze")).toHaveLength(3);
  });

  it("opens no card with nothing frozen, and answers the card that waits to a second call", async () => {
    const test = await startWithTwoAgents();
    await expect(unfreeze(test)).resolves.toStrictEqual({ ok: true, value: {} });
    await expect(unfreeze(test, testAgent)).resolves.toStrictEqual({ ok: true, value: {} });
    await freeze(test, secondAgent);
    const intent = await opened(test, secondAgent);
    await expect(opened(test, secondAgent)).resolves.toBe(intent);
    await expect(opened(test)).resolves.not.toBe(intent);
  });

  it("leaves the agent frozen when the owner cancels the card, or a freeze comes first", async () => {
    const test = await startWithTwoAgents();
    await freeze(test, testAgent);
    const denied = await opened(test, testAgent);
    expectOk(await tap(test, denied, "deny"));
    await expect(stateOf(test, denied)).resolves.toBe("denied");
    const waiting = await opened(test, testAgent);
    await freeze(test);
    await expect(stateOf(test, waiting)).resolves.toBe("cancelled");
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs, testNowMs]);
    expect(unfrozenNotices(test)).toStrictEqual([]);
  });

  it("shows its request and no assets to intent/get, and no trade quote", async () => {
    const test = await startWithTwoAgents();
    await freeze(test, testAgent);
    const intent = await opened(test, testAgent);
    const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
    expect(view).toMatchObject({
      intent,
      kind: "unfreeze",
      state: "awaiting_confirmation",
      request: { kind: "unfreeze", agent: testAgent },
      assets: {},
    });
    expect(view.quote).toBeUndefined();
  });

  it("takes the tap while the engine is locked, since an unfreeze signs nothing", async () => {
    const test = await startWithTwoAgents({ isLocked: () => true });
    await freeze(test, testAgent);
    const intent = await opened(test, testAgent);
    expectOk(await tap(test, intent, "confirm"));
    await expect(stateOf(test, intent)).resolves.toBe("reconciled");
  });

  it("writes an unfreeze a stop left confirmed once the owner asks again", async () => {
    const test = await startWithTwoAgents({ intents: stoppedOnce });
    await freeze(test, testAgent);
    const intent = await opened(test, testAgent);
    await expect(tap(test, intent, "confirm")).rejects.toThrow("stopped");
    await expect(stateOf(test, intent)).resolves.toBe("confirmed");
    await expect(opened(test, testAgent)).resolves.toBe(intent);
    await expect(stateOf(test, intent)).resolves.toBe("reconciled");
    await expect(frozenTimes(test)).resolves.toStrictEqual([undefined, undefined]);
  });

  it("refuses a caller without confirm, and an unknown agent", async () => {
    const test = await startWithTwoAgents();
    await freeze(test);
    await expect(unfreeze(test, undefined, testCallers.mcp)).resolves.toStrictEqual(
      err("auth.scope"),
    );
    await expect(unfreeze(test, undefined, testCallers.runtime)).resolves.toStrictEqual(
      err("auth.scope"),
    );
    await expect(unfreeze(test, third)).resolves.toStrictEqual(err("agent.not_found"));
  });

  it("writes an unfreeze again when another write beat it", async () => {
    const test = await startWithTwoAgents({ intents: beaten(4) });
    await freeze(test, testAgent);
    const intent = await opened(test, testAgent);
    expectOk(await tap(test, intent, "confirm"));
    await expect(stateOf(test, intent)).resolves.toBe("reconciled");
    await expect(frozenTimes(test)).resolves.toStrictEqual([undefined, undefined]);
  });

  it("gives up an unfreeze other writes beat five times in a row, and keeps it confirmed", async () => {
    const test = await startWithTwoAgents({ intents: beaten(5) });
    await freeze(test, testAgent);
    const intent = await opened(test, testAgent);
    await expect(tap(test, intent, "confirm")).rejects.toMatchObject({
      code: "engine.unfreeze_contended",
    });
    await expect(stateOf(test, intent)).resolves.toBe("confirmed");
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs, undefined]);
    expect(unfrozenNotices(test)).toStrictEqual([]);
  });

  it("leaves the agents frozen when a freeze lands between the tap and the write", async () => {
    const braking = freezeBetween();
    const test = await startWithTwoAgents({ intents: beaten(1, braking.between) });
    braking.bind(test);
    await freeze(test, testAgent);
    const intent = await opened(test, testAgent);
    expectOk(await tap(test, intent, "confirm"));
    await expect(stateOf(test, intent)).resolves.toBe("cancelled");
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs, testNowMs]);
    expect(unfrozenNotices(test)).toStrictEqual([]);
  });
});
