import { bpsSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testAgent, testLimits } from "../intents/test-intents.js";
import { limitChangeCancelledKey, limitChangeKey, limitNotices } from "./limit-notices.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);
const mover = { agent: testAgent, surface: "console" };
const waiting = { values: { ...testLimits, taxBps: bpsSchema.parse(9_000) }, atMs };

describe("the limit change notice", () => {
  it("names the limit and the surface, and says when a looser limit changes", () => {
    const when = english.dateTime(atMs);
    const later = { surface: "mini", limit: "perTradeUsdMicros", pending: "yes", when };
    const now = { surface: "cli", limit: "gasReserve", pending: "no" };
    expect([
      english.message(limitChangeKey, later),
      english.message(limitChangeKey, now),
    ]).toStrictEqual([
      `Limit changed by the Mini App: the per-trade cap changes at ${when}. Not you? Cancel now.`,
      "Limit changed by the CLI: the gas reserve changed now",
    ]);
  });

  it("says which looser limit was cancelled", () => {
    expect(english.message(limitChangeCancelledKey, { limit: "denyTokens" })).toBe(
      "Limit change cancelled for the list of tokens it may not trade; the limit in effect stays",
    );
  });

  it("announces nothing for a move that changed nothing", () => {
    const state = { values: testLimits, pending: waiting };
    expect(limitNotices(mover, state, state)).toStrictEqual([]);
  });

  it("announces again every limit that waits once a new loosening starts the wait again", () => {
    const later = { values: { ...waiting.values, perTradeUsdMicros: 1n }, atMs: atMs + 1 };
    const notices = limitNotices(
      mover,
      { values: testLimits, pending: waiting },
      {
        values: testLimits,
        pending: later,
      },
    );
    expect(notices.map((push) => push.data)).toStrictEqual([
      {
        key: limitChangeKey,
        agent: testAgent,
        values: { surface: "console", limit: "perTradeUsdMicros", pending: "yes" },
        times: { when: atMs + 1 },
      },
      {
        key: limitChangeKey,
        agent: testAgent,
        values: { surface: "console", limit: "taxBps", pending: "yes" },
        times: { when: atMs + 1 },
      },
    ]);
  });
});
