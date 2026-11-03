import { accountRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { startOrderEngine } from "../orders/test-orders.js";
import { createdRule, shownRule, testRuleRequest } from "./test-webhook-rules.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });

// The icons of spec 4, built from their code points: no emoji sits in code.
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);
const check = String.fromCodePoint(0x2705);

const thirtyDaysMs = 2_592_000_000;

describe("a webhook rule's card", () => {
  it("shows its name, what each alert sells, its rate, its limits, its URL and paper only", async () => {
    const { card, receipt } = await shownRule("en");
    const expiry = formatter.dateTime(testNowMs + thirtyDaysMs);

    expect(card).toStrictEqual([
      `${waiting} Confirm alert rule · main · ${paper} Paper`,
      'Approve alert rule "BNB breakout": sell 50.00% of your TKN on each alert · at most 5 a minute',
      `No fill limit until ${expiry}`,
      "Its URL works once you confirm; anyone who has it can fire this rule inside its bounds",
      "It fills on paper only, even after this agent goes live: alert rules trade no live funds yet",
      `${paper} Paper mode: nothing is sent on chain`,
      `Expires at ${formatter.time(testNowMs + 600_000)}`,
    ]);
    expect(receipt).toBe(
      `${check} Alert rule "BNB breakout" active: sell 50.00% of your TKN on each alert · until ${expiry}`,
    );
  });

  it("words a buy with what it spends, its most fills and its worst price", async () => {
    const request = testRuleRequest({
      side: "buy",
      size: { usdMicros: 25_000_000n },
      maxFills: 3,
      worstPrice: 1_200_000n,
      maxSlippageBps: bpsSchema.parse(150),
    });
    const { card } = await shownRule("en", request);

    expect(card[1]).toBe(
      'Approve alert rule "BNB breakout": buy TKN with $25.00 of FAKE on each alert · at most 5 a minute',
    );
    expect(card[2]).toMatch(/^Up to 3 fills until /);
    expect(card).toContain("Every fill trades at $1.20 or better");
    expect(card[3]).toBe("Each fill takes at most 1.50% slippage");
  });

  it("says nothing of slippage for a rule that leaves it to its agent", async () => {
    const { card } = await shownRule("en");

    expect(card.some((line) => line.includes("slippage"))).toBe(false);
  });

  it("names the launch wallet that holds it, as every card of such an intent does", async () => {
    const launch = fixtureId("wal", 217);
    const test = await startOrderEngine({
      wallets: [testWallet, launch],
      custodyWallets: new Map([[launch, accountRefSchema.parse("fake:1:0x000000d9")]]),
    });
    const role = { agentId: testAgent, label: "curves", createdAtMs: testNowMs };
    test.stores.install.addWallet(testWalletRecord({ id: launch, ...role, role: "launch" }));

    const { intent } = await createdRule(test, testRuleRequest({ wallet: launch }));
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));

    expect(card.lines).toContainEqual({
      key: "card.launchWallet",
      values: { wallet: { type: "text", text: "curves" } },
    });
  });
});
