import type { DcaOrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testAgent, testToken } from "../intents/test-intents.js";
import { orderActionOf } from "./order-action-of.js";

const quotedAtMs = Date.parse("2027-01-01T00:00:00Z");
const expiresAtMs = Date.parse("2027-12-31T00:00:00Z");

function dcaQuote(cron: string) {
  const request: DcaOrderRequest = {
    kind: "dca",
    agent: testAgent,
    token: testToken,
    side: "buy",
    size: { usdMicros: 10_000_000n },
    trigger: { cron, timezone: "UTC" },
    expiresAt: expiresAtMs,
  };
  const order = fixtureId("ord", 1);
  return { order, request, expiresAtMs, hasLinkedExits: false, quotedAtMs };
}

describe("an auto order's action line", () => {
  it("shows a DCA order's first two runs after its quote (decision 0246)", () => {
    const action = orderActionOf(dcaQuote("0 9 * * 1"), { addressBook: [] });
    expect(action?.firstRunsAtMs).toStrictEqual([
      Date.parse("2027-01-04T09:00:00Z"),
      Date.parse("2027-01-11T09:00:00Z"),
    ]);
  });

  it("draws nothing for a DCA order whose period does not read, as no card can show it", () => {
    expect(orderActionOf(dcaQuote("61 * * * *"), { addressBook: [] })).toBeUndefined();
  });
});
