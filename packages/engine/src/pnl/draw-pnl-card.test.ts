import { type CardDisplay, cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { cardKeys } from "../confirmations/card-line.js";
import { drawPnlCard, type PnlCardFacts } from "./draw-pnl-card.js";
import {
  handWorked,
  handWorkedOnPaper,
  pricesNow,
  pricesWithoutToken,
  token,
  tokenFigures,
  tokenInfo,
} from "./pnl-fixtures.js";
import type { PositionFigures } from "./position-figures.js";

const paper = String.fromCodePoint(0x1f9ea);
const red = String.fromCodePoint(0x1f534);

const display: CardDisplay = {
  formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
  assets: { [token]: tokenInfo },
};

const rendered = (facts: PnlCardFacts): readonly string[] =>
  drawPnlCard(facts).map((line) => cardLineText(line, display));

const known = (figures: PositionFigures): PnlCardFacts => ({
  figures,
  agentName: "main",
  info: tokenInfo,
});

// A closed position of one sale, from 08:00 to 10:59 on Oct 9.
const lost: PositionFigures = {
  asset: token,
  isPaper: false,
  quantityBase: 0n,
  costUsdMicros: 0n,
  realizedUsdMicros: -1_000_001n,
  boughtUsdMicros: 3_000_000n,
  soldUsdMicros: 1_999_999n,
  venueFeeUsdMicros: 0n,
  networkFeeUsdMicros: 0n,
  sales: 1,
  openedAtMs: Date.UTC(2026, 9, 9, 8, 0),
  changedAtMs: Date.UTC(2026, 9, 9, 10, 59),
};

describe("a P&L card", () => {
  // The numbers are worked out step by step beside the trades, in pnl-fixtures.ts.
  it("matches the hand-worked example of an open position with fees and gas", async () => {
    const figures = await tokenFigures(handWorked.slice(0, 3), pricesNow);
    expect(figures).toMatchObject({
      quantityBase: 698_250_000_000_000_000_000n,
      costUsdMicros: 460_306_350n,
      valueUsdMicros: 642_390_000n,
      realizedUsdMicros: 97_126_350n,
      venueFeeUsdMicros: 3_700_000n,
      networkFeeUsdMicros: 880_000n,
      openedAtMs: Date.UTC(2026, 9, 2, 14, 5),
    });
    expect(rendered(known(figures))).toStrictEqual([
      `TKN · main · ${red} Live`,
      "Holding 698.25 TKN · value $642.39",
      "Average cost $0.66 · cost $460.31",
      "P&L unrealized +$182.08 (+39.55%) · realized +$97.13",
      "Fees venue $3.70 · network $0.88",
      "Since Oct 2, 2026, 14:05:00",
    ]);
  });

  it("matches the hand-worked example of a closed trade, net of every fee and gas", async () => {
    const figures = await tokenFigures(handWorked, pricesNow);
    expect(figures).toMatchObject({
      quantityBase: 0n,
      boughtUsdMicros: 922_920_000n,
      soldUsdMicros: 1_221_151_000n,
      realizedUsdMicros: 298_231_000n,
      venueFeeUsdMicros: 5_362_500n,
      networkFeeUsdMicros: 1_144_000n,
      sales: 2,
      changedAtMs: Date.UTC(2026, 9, 9, 9, 12),
    });
    expect(figures.soldUsdMicros - figures.boughtUsdMicros).toBe(figures.realizedUsdMicros);
    expect(rendered(known(figures))).toStrictEqual([
      `TKN · main · ${red} Live · closed`,
      "Bought for $922.92 · sold for $1,221.15",
      "P&L realized +$298.23 (+32.31%)",
      "Fees venue $5.36 · network $1.14",
      "Held Oct 2, 2026, 14:05:00 → Oct 9, 2026, 09:12:00 (6 days)",
    ]);
  });

  it("says paper on a paper position's card", async () => {
    const open = await tokenFigures(handWorkedOnPaper.slice(0, 3), pricesNow);
    const closed = await tokenFigures(handWorkedOnPaper, pricesNow);
    expect([rendered(known(open))[0], rendered(known(closed))[0]]).toStrictEqual([
      `TKN · main · ${paper} Paper`,
      `TKN · main · ${paper} Paper · closed`,
    ]);
  });

  it("says a token has no price now instead of guessing its value", async () => {
    const figures = await tokenFigures(handWorked.slice(0, 3), pricesWithoutToken);
    expect(rendered(known(figures)).slice(1, 4)).toStrictEqual([
      "Holding 698.25 TKN",
      "Average cost $0.66 · cost $460.31",
      "P&L unrealized: no price now · realized +$97.13",
    ]);
  });

  it("names a token nothing knows by its short address and leaves out what needs decimals", async () => {
    const figures = await tokenFigures(handWorked.slice(0, 3), pricesNow);
    const lines = drawPnlCard({ figures, agentName: "main" });
    expect(lines.map(({ key }) => key)).toStrictEqual([
      "pnl.header",
      "pnl.open",
      "pnl.fees",
      "pnl.since",
    ]);
    expect(lines.slice(0, 1).map((line) => cardLineText(line, display))).toStrictEqual([
      `0xabab…abab · main · ${red} Live`,
    ]);
  });

  it("shows a loss with its sign, rounded toward the larger loss, and no share of a zero base", () => {
    const free = { ...lost, boughtUsdMicros: 0n, openedAtMs: Date.UTC(2026, 9, 9, 10, 58) };
    expect(rendered(known(lost)).slice(2)).toStrictEqual([
      "P&L realized -$1.00 (-33.34%)",
      "Fees venue $0.00 · network $0.00",
      "Held Oct 9, 2026, 08:00:00 → Oct 9, 2026, 10:59:00 (2 hours)",
    ]);
    expect(rendered(known(free)).slice(2)).toStrictEqual([
      "P&L realized -$1.00 (n/a)",
      "Fees venue $0.00 · network $0.00",
      "Held Oct 9, 2026, 10:58:00 → Oct 9, 2026, 10:59:00 (1 minute)",
    ]);
  });

  it("draws only keys of the card catalog", async () => {
    const [open, closed] = await Promise.all([
      tokenFigures(handWorked.slice(0, 3), pricesNow),
      tokenFigures(handWorked, pricesNow),
    ]);
    const keys = [open, closed].flatMap((figures) =>
      drawPnlCard(known(figures)).map(({ key }) => key),
    );
    const catalog: readonly string[] = cardKeys;
    expect(keys.filter((key) => !catalog.includes(key))).toStrictEqual([]);
  });
});
