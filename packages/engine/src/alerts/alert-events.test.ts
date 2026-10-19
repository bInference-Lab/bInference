import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testAgent, testToken } from "../intents/test-intents.js";
import { activeAlerts } from "./alert-events.js";
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
