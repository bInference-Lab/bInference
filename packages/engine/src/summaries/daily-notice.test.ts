import { createFormatter, writeNotice } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { type DailyNoticeInput, dailyNotice, isIdle } from "./daily-notice.js";
import type { SummaryFacts } from "./summary-facts.js";

// The live and paper icons the card spec names.
const liveIcon = String.fromCodePoint(0x1f534);
const paperIcon = String.fromCodePoint(0x1f9ea);

const nowMs = Date.UTC(2027, 0, 16, 1);
const hourMs = 3_600_000;
const english = createFormatter({ locale: "en", timeZone: "UTC" });

// A day with live trades and nothing else: no paper, no orders, nothing waiting.
const quiet: SummaryFacts = {
  live: { totalUsdMicros: 80_000_000n, realizedUsdMicros: 0n, trades: 1 },
  paper: { totalUsdMicros: 0n, realizedUsdMicros: 0n, trades: 0 },
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
  },
};

function written(input: Partial<DailyNoticeInput>): readonly string[] {
  const notice = dailyNotice({
    agent: { id: testAgent, name: "main" },
    facts: quiet,
    nowMs,
    ...input,
  });
  return writeNotice(notice, { formatter: english, assetInfo: () => undefined }).split("\n");
}

const before = (agoMs: number) =>
  ({
    agentId: testAgent,
    date: "2027-01-15",
    atMs: nowMs - agoMs,
    outcome: "idle",
    liveUsdMicros: 100_000_000n,
  }) as const;

// The live line after a summary taken `agoMs` before.
const lineAfter = (agoMs: number) => written({ before: before(agoMs) })[1];

describe("the daily summary's lines", () => {
  it("leaves out a mode that holds and traded nothing, and the orders when there are none", () => {
    expect(written({})).toStrictEqual([
      "Daily summary for main, the last 24 hours",
      `${liveIcon} Live: $80.00; realized P&L $0.00`,
      "Model spend: $0.00, against a daily model budget of $3.00",
    ]);
  });

  it("measures the change from a summary 20 to 28 hours old, and from no other", () => {
    expect(lineAfter(20 * hourMs)).toBe(
      `${liveIcon} Live: $80.00, -$20.00 in 24 hours; realized P&L $0.00`,
    );
    expect(lineAfter(28 * hourMs)).toBe(
      `${liveIcon} Live: $80.00, -$20.00 in 24 hours; realized P&L $0.00`,
    );
    expect(lineAfter(20 * hourMs - 1)).toBe(`${liveIcon} Live: $80.00; realized P&L $0.00`);
    expect(lineAfter(28 * hourMs + 1)).toBe(`${liveIcon} Live: $80.00; realized P&L $0.00`);
  });

  it("tells a mode that held something yesterday and holds nothing now", () => {
    const emptied = { ...quiet, live: { totalUsdMicros: 0n, realizedUsdMicros: 0n, trades: 0 } };
    expect(written({ facts: emptied, before: before(24 * hourMs) })[1]).toBe(
      `${liveIcon} Live: $0.00, -$100.00 in 24 hours; realized P&L $0.00`,
    );
  });

  it("puts each skip reason on a line, the most frequent first, and past four the rest in one", () => {
    const skipped = [
      { reason: "nothing_to_sell", count: 4 },
      { reason: "copy_daily_cap", count: 3 },
      { reason: "worst_price", count: 2 },
      { reason: "missed", count: 1 },
      { reason: "late", count: 1 },
    ] as const;
    const facts = { ...quiet, fills: { filled: 0, skipped } };
    expect(written({ facts }).slice(3)).toStrictEqual([
      "Model spend: $0.00, against a daily model budget of $3.00",
      "4 skips: the wallet holds too little of this token",
      "3 skips: it would pass a leader's daily cap",
      "2 skips: the price is worse than the order's worst price",
      "2 skips for other reasons",
    ]);
    expect(
      written({ facts: { ...facts, fills: { filled: 0, skipped: skipped.slice(1) } } }).at(-1),
    ).toBe("1 skip: it could not start within a minute of its time, so it is not made up later");
  });
});

describe("a daily summary with much to tell", () => {
  it("takes at most twelve lines, the skip reasons in what is left of them", () => {
    const skipped = [
      { reason: "nothing_to_sell", count: 4 },
      { reason: "worst_price", count: 2 },
    ] as const;
    const facts: SummaryFacts = {
      ...quiet,
      paper: { totalUsdMicros: 5_000_000n, realizedUsdMicros: 0n, trades: 0 },
      fills: { filled: 1, skipped },
      openOrders: 2,
      waits: {
        cards: 2,
        question: true,
        limits: 3,
        heldWallets: 1,
        sendLevel: true,
        rescueAddress: true,
      },
    };
    expect(written({ facts })).toStrictEqual([
      "Daily summary for main, the last 24 hours",
      `${liveIcon} Live: $80.00; realized P&L $0.00`,
      `${paperIcon} Paper: $5.00; realized P&L $0.00`,
      "Auto orders: 1 filled, 6 skipped, 2 open",
      "Model spend: $0.00, against a daily model budget of $3.00",
      "2 cards wait for your answer",
      "The agent waits for your answer to its question",
      "3 looser limits take effect within 24 hours",
      "1 wallet waits behind a stuck transaction",
      "A looser send level takes effect within 24 hours",
      "A new rescue address takes effect within 24 hours",
      "6 skips for other reasons",
    ]);
  });
});

describe("an idle agent", () => {
  it("is one with no live funds, trade, fill, skip, spend, open order or anything waiting", () => {
    const idle = { ...quiet, live: { totalUsdMicros: 0n, realizedUsdMicros: 0n, trades: 0 } };
    expect(isIdle(idle)).toBe(true);
    expect(isIdle(quiet)).toBe(false);
    expect(isIdle({ ...idle, spendUsdMicros: 1n })).toBe(false);
    expect(isIdle({ ...idle, openOrders: 1 })).toBe(false);
    expect(isIdle({ ...idle, waits: { ...idle.waits, question: true } })).toBe(false);
    expect(isIdle({ ...idle, fills: { filled: 0, skipped: [{ reason: "late", count: 1 }] } })).toBe(
      false,
    );
  });

  it("holds live funds, or held some at its last summary when they cannot be read now", () => {
    const holding = { ...quiet, live: { ...quiet.live, trades: 0 } };
    const unread = { ...quiet, live: { realizedUsdMicros: 0n, trades: 0 } };
    expect(isIdle(holding)).toBe(false);
    expect(isIdle(unread)).toBe(true);
    expect(isIdle(unread, before(24 * hourMs))).toBe(false);
    expect(isIdle(unread, { ...before(24 * hourMs), liveUsdMicros: 0n })).toBe(true);
  });
});
