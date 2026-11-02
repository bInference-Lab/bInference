import { createFormatter, writeNotice } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { dailyNotice } from "./daily-notice.js";
import type { SummaryFacts } from "./summary-facts.js";

// Paper alone, with two late bridges and an unstake ready to claim.
const facts: SummaryFacts = {
  live: { realizedUsdMicros: 0n, trades: 0 },
  paper: { totalUsdMicros: 5_000_000n, realizedUsdMicros: 0n, trades: 0 },
  fills: { filled: 0, skipped: [] },
  openOrders: 0,
  spendUsdMicros: 0n,
  budgetUsdMicros: 3_000_000n,
  waits: {
    cards: 0,
    question: false,
    limits: 0,
    heldWallets: 0,
    sendLevel: false,
    rescueAddress: false,
    lateBridges: 2,
    readyClaims: 1,
  },
};

describe("a daily summary of bridges and unstakes in Chinese", () => {
  it("tells how many bridges are late and how many unstakes are ready to claim", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    const nowMs = Date.UTC(2027, 0, 16, 1);
    const notice = dailyNotice({ agent: { id: testAgent, name: "main" }, nowMs, facts });
    const lines = writeNotice(notice, { formatter: chinese, assetInfo: () => undefined });
    expect(lines.split("\n").slice(-2)).toStrictEqual(["2 笔跨链已延迟", "1 笔解除质押可以领取"]);
  });
});
