import type { PnlCardView, PortfolioView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { pnlAnswer, portfolioAnswer } from "../testing/portfolio-fixture";
import { holdingSections } from "./portfolio-sections";

const view: PortfolioView = portfolioAnswer as unknown as PortfolioView;
const cards: readonly PnlCardView[] = pnlAnswer.cards as unknown as readonly PnlCardView[];

describe("the holding sections", () => {
  it("puts live before paper, each with the engine's own total, balances and cards", () => {
    const sections = holdingSections(view, cards);
    expect(
      sections.map(({ mode, totalUsdMicros, hasUnpriced, wallets, open, closed }) => ({
        mode,
        totalUsdMicros,
        hasUnpriced,
        values: wallets.flatMap(({ balances }) => balances.map(({ usdMicros }) => usdMicros)),
        cards: [...open, ...closed].map(({ paper, closed: isClosed }) => [paper, isClosed]),
      })),
    ).toStrictEqual([
      {
        mode: "live",
        totalUsdMicros: 420_500_000n,
        hasUnpriced: true,
        values: [120_500_000n, undefined, 300_000_000n],
        cards: [
          [false, false],
          [false, true],
        ],
      },
      {
        mode: "paper",
        totalUsdMicros: 1_100_000_000n,
        hasUnpriced: false,
        values: [600_000_000n, 500_000_000n],
        cards: [[true, false]],
      },
    ]);
  });

  it("leaves out a mode with no balance and no card", () => {
    const live = { ...view, balances: view.balances.filter(({ paper }) => !paper) };
    const liveCards = cards.filter(({ paper }) => !paper);
    expect(holdingSections(live, liveCards).map(({ mode }) => mode)).toStrictEqual(["live"]);
    expect(holdingSections({ ...view, balances: [] }, [])).toStrictEqual([]);
  });

  it("keeps a mode whose positions all closed", () => {
    const closedOnly = cards.filter(({ closed }) => closed);
    const sections = holdingSections({ ...view, balances: [] }, closedOnly);
    expect(sections.map(({ mode, wallets }) => [mode, wallets.length])).toStrictEqual([
      ["live", 0],
    ]);
  });
});
