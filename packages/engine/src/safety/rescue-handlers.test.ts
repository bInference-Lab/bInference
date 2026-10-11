import { accountRefParts } from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { planDocument } from "../intents/intent-documents.schema.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import { expectOk, testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import {
  listedArchived,
  startTestEngine,
  testCall,
  testCallers,
  testChains,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import {
  payloadOf,
  rescueCustody,
  rescueSteps,
  secondAgent,
  setUpRescue,
  testHeld,
  testMoves,
  testRescue,
} from "./test-rescue.js";

const live = { signal: new AbortController().signal };

async function startRescuing(options: TestEngineOptions = {}): Promise<TestEngine> {
  const test = await startTestEngine({
    custodyWallets: rescueCustody,
    held: testHeld,
    chainSimulator: createFakeTxSimulator(rescueSteps()),
    ...options,
  });
  await setUpRescue(test);
  return test;
}

async function rescue(test: TestEngine, caller = testCallers.cli) {
  return test.engine.handlers["safety/rescue"](testCall({}, caller));
}

// The rescue's quote and plan as the intent stores them.
async function storedOf(test: TestEngine, intent: Id<"int">) {
  const record = await recordOf(test, intent);
  if (record.quote === undefined || record.plan === undefined) {
    throw new Error(`Expected intent ${intent} to be quoted.`);
  }
  return {
    quote: rescueQuoteDocument.decode(record.quote),
    plan: planDocument.decode(record.plan),
  };
}

// Taps Confirm on the rescue's current card version from the CLI.
async function confirm(test: TestEngine, intent: Id<"int">) {
  const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error(`Expected intent ${intent} to have a card.`);
  }
  const args = { intent, card, cardVersion: view.card?.version ?? 1 };
  return test.engine.handlers["intent/confirm"](testCall(args));
}

// The card the rescue's first card version draws.
async function drawnCard(test: TestEngine, intent: Id<"int">) {
  const [card] = await test.stores.intents.cards(intent, live);
  if (card === undefined) {
    throw new Error(`Expected intent ${intent} to have a card.`);
  }
  const showings = createCardShowings({
    intents: test.stores.intents,
    agents: test.stores.agents,
    chains: testChains(),
  });
  return (await showings.opened({ intent, card: card.id }, live))?.card;
}

// The simulator under which the rescue's first move, the token's send, would not run as planned.
function withoutToken() {
  return createFakeTxSimulator(rescueSteps(testMoves.slice(0, 1)));
}

async function recordOf(test: TestEngine, intent: Id<"int">) {
  const record = await test.stores.intents.get(intent, live);
  if (record === undefined) {
    throw new Error(`Expected intent ${intent}.`);
  }
  return record;
}

function notices(test: TestEngine): readonly unknown[] {
  return test.pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
}

describe("safety/rescue", () => {
  it("opens one live card that sends every token and the coin above the reserve of every wallet", async () => {
    const test = await startRescuing();
    const { intent } = expectOk(await rescue(test));
    const record = await recordOf(test, intent);
    expect(record).toMatchObject({
      kind: "rescue",
      state: "awaiting_confirmation",
      isPaper: false,
      agentId: testAgent,
      request: { kind: "rescue" },
    });
    const { quote, plan } = await storedOf(test, intent);
    expect(quote).toStrictEqual({
      rescue: testRescue,
      moves: testMoves,
      valueUsdMicros: ((15n * 10n ** 17n - 2n * 10n ** 15n) * 600n) / 10n ** 12n,
      quotedAtMs: testNowMs,
    });
    expect(plan.map(({ payload }) => payload)).toStrictEqual(testMoves.map(payloadOf));
    const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
    expect(view).toMatchObject({ kind: "rescue", request: { kind: "rescue" }, paper: false });
    expect(Object.keys(view.assets).toSorted()).toStrictEqual([testCoin, testToken].toSorted());
    expect(view.simulation).toMatchObject({
      spent: [
        { asset: testToken, base: 500n },
        { asset: testCoin, base: 15n * 10n ** 17n - 2n * 10n ** 15n },
      ],
    });
    expect(test.pushes.some(({ kind }) => kind === "card/opened")).toBe(true);
  });

  it("opens its card while every agent is frozen and at the strictest send level", async () => {
    const test = await startRescuing();
    expectOk(await test.engine.handlers["safety/freeze"](testCall({})));
    const levels = await Promise.all(
      [testAgent, secondAgent].map(async (agent) =>
        test.engine.handlers["sendLevel/set"](testCall({ agent, level: 3 })),
      ),
    );
    expect(levels.every(({ ok }) => ok)).toBe(true);
    const { intent } = expectOk(await rescue(test));
    await expect(recordOf(test, intent)).resolves.toMatchObject({
      state: "awaiting_confirmation",
    });
  });

  it("answers the rescue that has not ended to a second call, and plans nothing new", async () => {
    const test = await startRescuing();
    const [first, second] = await Promise.all([rescue(test), rescue(test)]);
    expect(second).toStrictEqual(first);
    const open = await test.stores.intents.list(
      { states: ["awaiting_confirmation"], limit: 10 },
      live,
    );
    expect(open.filter(({ kind }) => kind === "rescue")).toHaveLength(1);
  });

  it("is left alone by a freeze, and announced with its address once confirmed", async () => {
    const test = await startRescuing();
    const { intent } = expectOk(await rescue(test));
    expectOk(await test.engine.handlers["safety/freeze"](testCall({})));
    const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
    expect(view.state).toBe("awaiting_confirmation");
    expect(expectOk(await confirm(test, intent)).state).toBe("confirmed");
    expect(test.executor.taken()).toStrictEqual([intent]);
    expect(notices(test).at(-1)).toStrictEqual({
      key: "notice.rescue",
      agent: testAgent,
      values: { address: accountRefParts(testRescue).address },
      intent,
    });
  });

  it("leaves out a send that would not run as planned, and moves the rest", async () => {
    const test = await startRescuing({ chainSimulator: withoutToken() });
    const { intent } = expectOk(await rescue(test));
    const { quote } = await storedOf(test, intent);
    expect(quote.moves).toStrictEqual(testMoves.slice(1));
  });

  it("refuses with nothing to move, with no rescue address, and to a caller without confirm", async () => {
    const empty = await startRescuing({ held: new Map() });
    await expect(rescue(empty)).resolves.toStrictEqual(err("rescue.nothing_to_move"));
    const bare = await startTestEngine();
    await expect(rescue(bare)).resolves.toStrictEqual(err("rescue.no_address"));
    const test = await startRescuing();
    await expect(rescue(test, testCallers.mcp)).resolves.toStrictEqual(err("auth.scope"));
    await expect(rescue(test, testCallers.runtime)).resolves.toStrictEqual(err("auth.scope"));
    expect(notices(test)).toStrictEqual([]);
  });

  it("refuses when every agent whose wallets hold funds is archived", async () => {
    const test = await startRescuing({ agents: listedArchived });
    await expect(rescue(test)).resolves.toStrictEqual(err("agent.not_found"));
    expect(notices(test)).toStrictEqual([]);
  });

  it("draws a card with the address, the tokens, the wallets and their value", async () => {
    const test = await startRescuing();
    const { intent } = expectOk(await rescue(test));
    const card = await drawnCard(test, intent);
    expect(card?.lines.slice(0, 2)).toStrictEqual([
      {
        key: "card.header",
        values: {
          action: { type: "choice", choice: "rescue" },
          agent: { type: "text", text: "main" },
          mode: { type: "choice", choice: "live" },
        },
      },
      {
        key: "card.rescue.action",
        values: {
          address: { type: "account", account: testRescue },
          count: { type: "count", count: 1 },
          wallets: { type: "count", count: 2 },
          usd: {
            type: "usd",
            usdMicros: ((15n * 10n ** 17n - 2n * 10n ** 15n) * 600n) / 10n ** 12n,
          },
        },
      },
    ]);
    expect(card?.lines.map(({ key }) => key)).not.toContain("card.reason");
  });
});
