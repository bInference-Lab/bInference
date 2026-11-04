import { accountRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import {
  activityItemSchema,
  type AlertCondition,
  type AlertFire,
  launchViewSchema,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { alertNotice } from "./alert-notices.js";
import type { AlertRecord } from "./alert-record.js";

const leader = accountRefSchema.parse("fake:1:0x0000aaaa");
const hash = `0x${"ab".repeat(32)}`;
const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

function alertOn(condition: AlertCondition): AlertRecord {
  return {
    id: idSchema("alr").parse("alr_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    agentId: testAgent,
    condition,
    state: "active",
    wake: false,
    fires: 1,
    outsideContent: false,
    createdBy: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
  };
}

const context = { chains: testChains(), addressBook: [], assets: {}, nowMs: testNowMs };

function noticeOf(condition: AlertCondition, fired: AlertFire) {
  return alertNotice({ alert: alertOn(condition), fired, agentName: "main", woke: false }, context);
}

// A launch made `ageMs` before now, its curve and tax unread.
function launchMade(ageMs: number): AlertFire {
  const launch = launchViewSchema.parse({
    chain: "fake:1",
    token: "fake:1/token:0x0000cafe",
    launchpad: "fake",
    creator: "fake:1:0x0000beef",
    quoteToken: testCoin,
    graduated: true,
    insiders: [],
    creatorLaunches30d: 2,
    block: 9,
    tx: hash,
    launchedAt: testNowMs - ageMs,
  });
  return { kind: "launch", launch };
}

const launchAlert: AlertCondition = { kind: "launch", filters: {} };

describe("an alert's notice", () => {
  it("names a wallet's trade nothing valued by what it paid, and an unread share as unknown", () => {
    const activity = activityItemSchema.parse({
      at: 1,
      block: 7,
      tx: hash,
      side: "buy",
      asset: testToken,
      amount: "5000000",
      counterAsset: testCoin,
      counterAmount: "1000000000000000000",
    });
    const notice = noticeOf({ kind: "wallet", account: leader }, { kind: "wallet", activity });
    expect(notice).toMatchObject({
      key: "notice.alertWallet",
      values: { wallet: "0x0000aaaa", side: "buy", share: "?" },
      amounts: {
        amount: { asset: testToken, base: 5_000_000n },
        value: { asset: testCoin, base: 10n ** 18n },
      },
    });
    expect(notice.values).not.toHaveProperty("value");
  });

  it("words a launch's age in hours within two days, then in days", () => {
    const hours = noticeOf(launchAlert, launchMade(5 * hourMs));
    const days = noticeOf(launchAlert, launchMade(3 * dayMs));
    expect(hours.parts?.["launch"]?.parts?.["age"]).toStrictEqual({
      key: "launch.age",
      values: { unit: "hour", count: "5" },
    });
    expect(days.parts?.["launch"]?.parts?.["age"]).toStrictEqual({
      key: "launch.age",
      values: { unit: "day", count: "3" },
    });
  });

  it("shows a launch's unread curve and tax as unknown, and a graduated curve as such", () => {
    const notice = noticeOf(launchAlert, launchMade(60_000));
    expect(notice.parts?.["launch"]).toMatchObject({
      values: { tax: "?", creatorLaunches: "2" },
      parts: { curve: { values: { graduated: "yes", progress: "?" } } },
    });
  });

  it("faults on a fire of another kind than its alert's", () => {
    const fired: AlertFire = { kind: "price", asset: testToken, priceUsdMicros: 1n };
    expect(() => noticeOf({ kind: "wallet", account: leader }, fired)).toThrow(
      expect.objectContaining({ code: "engine.alert_fire_kind" }),
    );
  });
});
