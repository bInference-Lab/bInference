import type { PortfolioView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { portfolioAnswer } from "../testing/portfolio-fixture";
import { holdingSections } from "./portfolio-sections";

const view: PortfolioView = portfolioAnswer as unknown as PortfolioView;

describe("the holding sections", () => {
  it("puts live before paper, each with the engine's own total and balances", () => {
    const sections = holdingSections(view);
    expect(
      sections.map(({ mode, totalUsdMicros, hasUnpriced, wallets }) => ({
        mode,
        totalUsdMicros,
        hasUnpriced,
        values: wallets.flatMap(({ balances }) => balances.map(({ usdMicros }) => usdMicros)),
      })),
    ).toStrictEqual([
      {
        mode: "live",
        totalUsdMicros: 420_500_000n,
        hasUnpriced: true,
        values: [120_500_000n, undefined, 300_000_000n],
      },
      {
        mode: "paper",
        totalUsdMicros: 1_100_000_000n,
        hasUnpriced: false,
        values: [600_000_000n, 500_000_000n],
      },
    ]);
  });

  it("leaves out a mode with no balance", () => {
    const live = { ...view, balances: view.balances.filter(({ paper }) => !paper) };
    expect(holdingSections(live).map(({ mode }) => mode)).toStrictEqual(["live"]);
    expect(holdingSections({ ...view, balances: [] })).toStrictEqual([]);
  });
});
