import type { Bridge } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { saveTestAddress } from "../send-levels/test-sends.js";
import {
  type BridgeTest,
  bridgeEngine,
  testArrives,
  testDestination,
  testFarEntry,
  testRescueThere,
} from "./test-bridges.js";

const live = { signal: new AbortController().signal };
const amount = { asset: testToken, base: 100_000_000n };

async function quoteOf(bench: BridgeTest, change: Readonly<Record<string, unknown>> = {}) {
  const args = {
    agent: testAgent,
    wallet: testWallet,
    amount,
    toChain: testDestination,
    ...change,
  };
  return bench.test.engine.handlers["bridge/quote"](testCall(args));
}

// The rescue address joined the agent's bridge rules on the destination after its check.
async function joinRescue(bench: BridgeTest): Promise<void> {
  const records = [{ agent: testAgent, account: testRescueThere, state: "joined" as const }];
  await bench.test.stores.install.keepRescueReach(
    { agents: [testAgent], records, atMs: testNowMs },
    live,
  );
}

const route = {
  venue: "fake-cross",
  toChain: testDestination,
  sentAsset: testToken,
  deliveredAsset: testArrives,
  amountIn: amount,
  expectedOut: { asset: testArrives, base: 99_000_000n },
  minOut: { asset: testArrives, base: 99_000_000n },
};

describe("a bridge quote", () => {
  it("quotes each route for the saved address named, and stores nothing", async () => {
    const bench = await bridgeEngine();
    const quoted = expectOk(await quoteOf(bench, { to: { entry: testFarEntry.id } }));
    expect(quoted.items).toHaveLength(1);
    expect(quoted.items[0]).toMatchObject(route);
    const listed = expectOk(
      await bench.test.engine.handlers["intent/list"](testCall({ agent: testAgent })),
    );
    expect(listed.items).toStrictEqual([]);
  });

  it("prices a quote with no recipient for the rescue address where the bridge rules joined it", async () => {
    const bench = await bridgeEngine();
    await joinRescue(bench);
    expect(expectOk(await quoteOf(bench)).items[0]).toMatchObject(route);
  });

  it("prices a quote with no recipient for the rescue address saved on that chain", async () => {
    const bench = await bridgeEngine();
    const saved = {
      ...testFarEntry,
      id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-0000000000b2"),
      account: testRescueThere,
      recipientBytes: "0x000000d9",
      label: "rescue there",
    };
    await saveTestAddress(bench.test, saved);
    expect(expectOk(await quoteOf(bench)).items[0]).toMatchObject(route);
  });

  it("asks for a saved address when no recipient is named and the rescue address cannot be paid there", async () => {
    const bench = await bridgeEngine();
    expect(await quoteOf(bench)).toStrictEqual({ ok: false, error: "address.no_recipient" });
  });

  it("refuses an unknown agent, and answers that the venue is down when no route answers", async () => {
    const bench = await bridgeEngine();
    const stranger = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009";
    expect(await quoteOf(bench, { agent: stranger })).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    const down: Bridge = {
      ...bench.bridge,
      quote: async () => Promise.reject(new Error("down")),
    };
    const silent = await bridgeEngine({ bridge: down });
    expect(await quoteOf(silent, { to: { entry: testFarEntry.id } })).toStrictEqual({
      ok: false,
      error: "quote.venue_down",
    });
  });
});
