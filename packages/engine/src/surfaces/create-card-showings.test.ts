import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { CardRecord } from "../intents/card-record.js";
import { quoteDocument, requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testCoin, testNowMs, testSwap, testToken } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
  testCallers,
  testChains,
} from "../operations/test-engine.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { cardFactsOf } from "./card-facts-of.js";
import { createCardShowings } from "./create-card-showings.js";
import { present, worseAfterFirstQuote } from "./test-venues.js";

const live = { signal: new AbortController().signal };

interface Shown {
  readonly test: TestEngine;
  readonly intent: Id<"int">;
  readonly card: CardRecord;
}

async function proposed(options: TestEngineOptions = {}): Promise<Shown> {
  const test = await startTestEngine(options);
  const view = expectOk(
    await test.engine.handlers["intent/propose"](testCall(testSwap(), testCallers.mcp)),
  );
  const [card] = await test.stores.intents.cards(view.intent, live);
  return { test, intent: view.intent, card: present(card) };
}

interface StoresSeen {
  readonly intents?: IntentStore;
  readonly agents?: AgentStore;
}

function showingsOf(test: TestEngine, stores: StoresSeen = {}) {
  return createCardShowings({
    intents: stores.intents ?? test.stores.intents,
    agents: stores.agents ?? test.stores.agents,
    chains: testChains(),
  });
}

async function answer(shown: Shown, decision: "confirm" | "deny"): Promise<void> {
  const answeredBy = { surface: "telegram", by: "tg:1" } as const;
  const card = { intent: shown.intent, decision, cardVersion: shown.card.version, answeredBy };
  expectOk(await shown.test.engine.answer(card, live));
}

async function recordOf(shown: Shown): Promise<IntentRecord> {
  return present(await shown.test.stores.intents.get(shown.intent, live));
}

describe("the card showings", () => {
  it("draw an open card version from the stored intent, with its reference and assets", async () => {
    const shown = await proposed();
    const ref = { intent: shown.intent, card: shown.card.id };
    const showing = present(await showingsOf(shown.test).opened(ref, live));
    expect(showing.callbackRef).toBe(shown.card.callbackRef);
    expect([showing.card.version, showing.card.expiresAtMs]).toStrictEqual([1, testNowMs + 60_000]);
    const [, action, route, check] = showing.card.lines;
    expect(showing.card.lines.map((line) => line.key)).toStrictEqual([
      "card.header",
      "card.swap.action",
      "card.route",
      "card.check",
      "card.warn.paper",
      "card.reason",
      "card.expiry",
    ]);
    expect(action?.values).toStrictEqual({
      in: { type: "amount", amount: { asset: testCoin, base: 1_000_000n } },
      minOut: { type: "amount", amount: { asset: testToken, base: 1_990_000n } },
    });
    expect(route?.values).toMatchObject({
      route: {
        type: "route",
        venue: "fake-swap",
        legs: [{ venue: "fake-swap", shareBps: 10_000 }],
      },
      slippage: { type: "percent", bps: 50 },
    });
    expect(check?.values).toMatchObject({
      received: { type: "amount", amount: { asset: testToken, base: 2_000_000n } },
      verified: { type: "choice", choice: "yes" },
    });
    expect(Object.keys(showing.assets)).toStrictEqual([testCoin, testToken]);
  });

  it("say on a live agent's first card that it trades real money", async () => {
    const shown = await proposed({ agent: { mode: "live" } });
    const ref = { intent: shown.intent, card: shown.card.id };
    const showing = present(await showingsOf(shown.test).opened(ref, live));
    const keys = showing.card.lines.map((line) => line.key);
    expect(keys).toContain("card.warn.firstLive");
    expect(keys).not.toContain("card.warn.paper");
  });

  it("draw nothing once the card closed, for an unknown version, or without a reference", async () => {
    const shown = await proposed();
    const showings = showingsOf(shown.test);
    const unknownCard = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"crd">;
    const unknownIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"int">;
    expect(await showings.opened({ intent: shown.intent, card: unknownCard }, live)).toBe(
      undefined,
    );
    expect(await showings.opened({ intent: unknownIntent, card: shown.card.id }, live)).toBe(
      undefined,
    );
    const { intents } = shown.test.stores;
    const withoutRefs: IntentStore = {
      ...intents,
      cards: async (id, call) =>
        (await intents.cards(id, call)).map(({ callbackRef: _ref, ...card }) => card),
    };
    const ref = { intent: shown.intent, card: shown.card.id };
    expect(await showingsOf(shown.test, { intents: withoutRefs }).opened(ref, live)).toBe(
      undefined,
    );
    await answer(shown, "confirm");
    expect(await showings.opened(ref, live)).toBe(undefined);
    const settledWithout = await showingsOf(shown.test, { intents: withoutRefs }).settled(
      shown.intent,
      live,
    );
    expect(settledWithout).toBe(undefined);
  });

  it("fault when the intent's agent is not stored", async () => {
    const shown = await proposed();
    const { agents } = shown.test.stores;
    const lost: AgentStore = { ...agents, get: async () => Promise.resolve(undefined) };
    const ref = { intent: shown.intent, card: shown.card.id };
    await expect(showingsOf(shown.test, { agents: lost }).opened(ref, live)).rejects.toMatchObject({
      code: "engine.agent_missing",
    });
  });

  it("settle a confirmed paper intent with its fill, once it recorded the fill", async () => {
    const confirmed = await proposed();
    expect(await showingsOf(confirmed.test).settled(confirmed.intent, live)).toBe(undefined);
    await answer(confirmed, "confirm");
    expect(await showingsOf(confirmed.test).settled(confirmed.intent, live)).toStrictEqual({
      ref: confirmed.card.callbackRef,
      closing: {
        outcome: "confirmed",
        answeredBy: { surface: "telegram", by: "tg:1" },
        atMs: testNowMs,
      },
      paper: {
        fill: {
          amountIn: { asset: testCoin, base: 1_000_000n },
          amountOut: { asset: testToken, base: 2_000_000n },
        },
        assets: {
          [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
          [testToken]: { symbol: "TKN", name: "Token", decimals: 6, verified: true },
        },
      },
    });
    const { intents } = confirmed.test.stores;
    const beforeFill: IntentStore = {
      ...intents,
      events: async (id, call) =>
        (await intents.events(id, call)).filter((event) => event.toState !== "paper_filled"),
    };
    const waiting = showingsOf(confirmed.test, { intents: beforeFill });
    expect(await waiting.settled(confirmed.intent, live)).toBe(undefined);
  });

  it("settle a denied or expired version, and a live one confirmed, with the closing", async () => {
    const denied = await proposed();
    await answer(denied, "deny");
    expect(await showingsOf(denied.test).settled(denied.intent, live)).toStrictEqual({
      ref: denied.card.callbackRef,
      closing: {
        outcome: "denied",
        answeredBy: { surface: "telegram", by: "tg:1" },
        atMs: testNowMs,
      },
    });
    const late = await proposed();
    await late.test.clock.advance(60_000);
    await answer(late, "deny");
    expect(await showingsOf(late.test).settled(late.intent, live)).toMatchObject({
      closing: { outcome: "expired" },
    });
    const sent = await proposed({ agent: { mode: "live" } });
    await answer(sent, "confirm");
    const settling = await showingsOf(sent.test).settled(sent.intent, live);
    expect([settling?.closing.outcome, settling?.paper]).toStrictEqual(["confirmed", undefined]);
  });

  it("settle no version that a worse re-quote replaced, nor an unknown intent", async () => {
    const shown = await proposed({ venues: [worseAfterFirstQuote()] });
    await shown.test.clock.advance(11_000);
    await answer(shown, "confirm");
    expect(await showingsOf(shown.test).settled(shown.intent, live)).toBe(undefined);
    const unknownIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"int">;
    expect(await showingsOf(shown.test).settled(unknownIntent, live)).toBe(undefined);
  });

  it("read no facts for another kind of intent, or one without a quote", async () => {
    const shown = await proposed();
    const record = await recordOf(shown);
    const settings = present(await shown.test.stores.agents.get(record.agentId, live));
    const source = { card: shown.card, settings, isFirstLive: false, chains: testChains() };
    const { quote: _quote, ...unquoted } = record;
    expect(cardFactsOf({ ...source, record: unquoted })).toBe(undefined);
    const send = requestDocument.encode({
      kind: "send",
      agent: record.agentId,
      reason: "Pay the owner back",
      amount: { asset: testCoin, base: 1n },
      to: { name: "owner.bnb" },
    });
    expect(cardFactsOf({ ...source, record: { ...record, request: send } })).toBe(undefined);
    const { simulation: _simulation, ...unsimulated } = record;
    const quote = quoteDocument.decode(present(record.quote));
    const routeless = { ...unsimulated, quote: quoteDocument.encode({ ...quote, route: [] }) };
    const facts = present(cardFactsOf({ ...source, record: routeless }));
    expect([facts.route, facts.check]).toStrictEqual([undefined, undefined]);
  });
});
