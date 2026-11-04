import { accountRefSchema } from "@binference/chain";
import { activityItemSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { activeAlerts, canonicalTrade } from "./alert-events.js";
import type { AlertQuery, AlertRecord } from "./alert-record.js";

const live = { signal: new AbortController().signal };

function alertOf(n: number): AlertRecord {
  return {
    id: fixtureId("alr", n),
    agentId: testAgent,
    condition: { kind: "price", asset: testToken, direction: "above", price: 1n },
    state: "active",
    wake: false,
    fires: 0,
    outsideContent: false,
    createdBy: "cli",
    createdAtMs: n,
    changedAtMs: n,
  };
}

// A store that answers two of `stored` a page, whatever the limit asked, noting each query.
function twoAPage(stored: readonly AlertRecord[]) {
  const queries: AlertQuery[] = [];
  const alerts = {
    list: async (query: AlertQuery) => {
      queries.push(query);
      const from = query.after?.createdAtMs ?? 0;
      return Promise.resolve(stored.filter(({ createdAtMs }) => createdAtMs > from).slice(0, 2));
    },
  };
  return { queries, alerts };
}

describe("activeAlerts", () => {
  it("reads every page, however few alerts a page holds", async () => {
    const stored = Array.from({ length: 5 }, (_, index) => alertOf(index + 1));
    const { queries, alerts } = twoAPage(stored);

    const read = await activeAlerts(alerts, { kind: "price", asset: testToken }, live);

    expect(read.map(({ id }) => id)).toStrictEqual(stored.map(({ id }) => id));
    expect(queries).toHaveLength(4);
    expect(queries[0]).toStrictEqual({
      states: ["active"],
      limit: 1_000,
      kind: "price",
      asset: testToken,
    });
  });
});

// A buy by `account` of `asset` for `counterAsset`, as a watcher hands it.
function buyOf(account: string, asset: string, counterAsset: string) {
  const activity = activityItemSchema.parse({
    at: 1,
    block: 7,
    tx: `0x${"ab".repeat(32)}`,
    side: "buy",
    asset,
    amount: "5",
    counterAsset,
    counterAmount: "1",
  });
  return { account: accountRefSchema.parse(account), activity, assets: {} };
}

describe("canonicalTrade", () => {
  it("keeps a trade's account and assets as given on a chain no registry holds", () => {
    const elsewhere = buyOf("fake:9:0x0000AAAA", "fake:9/token:0x0000BBBB", "fake:9/slip44:1");
    expect(canonicalTrade(testChains(), elsewhere)).toStrictEqual(elsewhere);
  });

  it("puts an account and assets a watcher handed in another case in canonical form", () => {
    const shouted = buyOf("fake:1:0x0000AAAA", "fake:1/token:0x0000000A", testCoin);
    const canonical = canonicalTrade(testChains(), shouted);
    expect([
      canonical.account,
      canonical.activity.asset,
      canonical.activity.counterAsset,
    ]).toStrictEqual(["fake:1:0x0000aaaa", testToken, testCoin]);
  });
});
